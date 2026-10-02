import asyncio
import re
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel

from . import contributors, db, gleif, gleif_api, hazards, loader, measures, network

UPLOAD_DIR = Path(tempfile.gettempdir()) / "uploads"   # an uploaded file waits here until it is confirmed


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.connect() as conn:
        db.init_schema(conn)
        loader.seed_demo(conn)      # first start only: the 4 demo companies
        gleif_api.rerate_all(conn)  # GLEIF API candidates rated with older rules: again, from the cache
        gleif_api.forget_failures(conn)   # GLEIF requests that failed: tried again
        gleif.refresh_all(conn)     # every start: re-read the GLEIF files, with the saved verdicts
    task = asyncio.create_task(_refresh_hazards())   # every start: one GDACS refresh in the background
    worker = asyncio.create_task(gleif_api.worker())  # GLEIF API searches and parent fetches, also after a restart
    yield
    task.cancel()
    worker.cancel()


app = FastAPI(title="Geographic Supplier Risk Intelligence", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/customers")
def customers() -> list[dict]:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("""SELECT c.customer_id, c.name, count(s.os_id) AS open_sites
                       FROM customer c LEFT JOIN site s USING (customer_id)
                       GROUP BY c.customer_id, c.name ORDER BY c.name""")
        return cur.fetchall()


def _thresholds(high: float, watch: float) -> None:
    if not 0 < watch <= high <= 100:
        raise HTTPException(400, "Thresholds must satisfy 0 < watch <= high <= 100.")


@app.get("/api/customers/{c}/view")
def customer_view(c: str, high: float = Query(10), watch: float = Query(5)) -> dict:
    _thresholds(high, watch)
    with db.connect() as conn:
        out = measures.view(conn, c, high, watch)
    if out is None:
        raise HTTPException(404, "Unknown company.")
    return out


@app.get("/api/customers/{c}/sites/{os_id}")
def site(c: str, os_id: str) -> dict:
    with db.connect() as conn:
        out = measures.site_detail(conn, c, os_id)
    if out is None:
        raise HTTPException(404, "Unknown site for this company.")
    return out


@app.get("/api/customers/{c}/owners/{owner}")
def owner(c: str, owner: str) -> dict:
    with db.connect() as conn:
        out = measures.owner_detail(conn, c, owner)
    if out is None:
        raise HTTPException(404, "Unknown owner for this company.")
    return out


@app.get("/api/customers/{c}/hazards/{event_id}")
def hazard(c: str, event_id: str) -> dict:
    with db.connect() as conn:
        out = measures.hazard_detail(conn, c, event_id)
    if out is None:
        raise HTTPException(404, "Unknown event.")
    return out


async def _refresh_hazards() -> dict:
    with db.connect() as conn:
        return await hazards.refresh(conn)


@app.post("/api/hazards/refresh")
async def refresh_hazards() -> dict:
    """List current GDACS events and store the affected areas of new or changed events."""
    return await _refresh_hazards()


@app.post("/api/uploads")
async def upload(file: UploadFile = File(...)) -> dict:
    """Step 1 of an upload: file in, the list strings in it (with site counts) out, and the choices the page
    pre-fills (contributors.suggest)."""
    raw = await file.read()
    try:
        rows = loader.read_rows(raw)
    except (UnicodeDecodeError, ValueError) as err:
        raise HTTPException(400, f"Could not read the file as an Open Supply Hub CSV: {err}")
    if not rows or "contributor (list)" not in rows[0]:
        raise HTTPException(400, "The file has no `contributor (list)` column; is it an Open Supply Hub download?")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    upload_id = uuid.uuid4().hex
    (UPLOAD_DIR / f"{upload_id}.csv").write_bytes(raw)
    return {"upload_id": upload_id, "file_name": file.filename, "rows": len(rows), "lists": loader.list_counts(rows),
            **contributors.suggest(rows)}


class Confirm(BaseModel):
    name: str
    lists: list[str]            # the company's own lists in the file
    current_lists: list[str]    # which of those are current
    customer_id: str | None = None


@app.post("/api/uploads/{upload_id}/confirm")
def confirm(upload_id: str, body: Confirm) -> dict:
    """Step 2 of an upload: load the file for this company. Replaces only this company's rows."""
    path = UPLOAD_DIR / f"{re.sub(r'[^0-9a-f]', '', upload_id)}.csv"
    if not path.exists():
        raise HTTPException(404, "Unknown upload.")
    if not body.name.strip() or not body.current_lists or not set(body.current_lists) <= set(body.lists):
        raise HTTPException(400, "Give a company name, and mark at least one of the picked lists as current.")
    customer_id = body.customer_id or re.sub(r"[^a-z0-9]+", "-", body.name.strip().lower()).strip("-")
    with db.connect() as conn:
        with conn.cursor() as cur:
            network.lock(cur)       # not at the same time as a verdict: both re-link GLEIF candidates
        out = loader.load_customer(conn, customer_id, body.name.strip(), path.read_bytes(), body.lists, body.current_lists)
        conn.commit()
        out["gleif_job"] = gleif_api.enqueue(conn, customer_id)   # GLEIF candidates, in the background (None: adidas, Nike)
    path.unlink(missing_ok=True)
    return out


@app.get("/api/network/candidates")
def network_candidates(company: str | None = Query(None)) -> list[dict]:
    """Company network page: the GLEIF candidates of the slice file, with their sites and verdicts; with
    `company` (a customer_id), only that company's (none for a company the file has no names for)."""
    with db.connect() as conn:
        return network.candidates(conn, company)


@app.get("/api/network/candidates/{i}")
def network_candidate(i: int) -> dict:
    with db.connect() as conn:
        out = network.candidate(conn, i)
    if out is None:
        raise HTTPException(404, "Unknown candidate.")
    return out


class Verdict(BaseModel):
    verdict: str                # yes (confirm) or no (reject)


@app.put("/api/network/candidates/{i}/verdict")
def network_verdict(i: int, body: Verdict) -> dict:
    if body.verdict not in ("yes", "no"):
        raise HTTPException(400, "The verdict is yes or no.")
    with db.connect() as conn:
        out = network.set_verdict(conn, i, body.verdict)
    if out is None:
        raise HTTPException(404, "Unknown candidate.")
    return out


@app.delete("/api/network/candidates/{i}/verdict")
def network_undo(i: int) -> dict:
    with db.connect() as conn:
        out = network.set_verdict(conn, i, None)
    if out is None:
        raise HTTPException(404, "Unknown candidate.")
    return out


@app.get("/api/network/jobs/{c}")
def network_job(c: str) -> dict:
    """The company's GLEIF API search: state, progress, and how many minutes a search would take."""
    with db.connect() as conn:
        return gleif_api.job(conn, c)


@app.post("/api/network/jobs/{c}")
def network_job_start(c: str) -> dict:
    """Search GLEIF's API for every owner name of the company, in the background (1 request a second)."""
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM customer WHERE customer_id = %s", (c,))
            if not cur.fetchone():
                raise HTTPException(404, "Unknown company.")
        conn.commit()
        if not gleif_api.eligible(c):
            raise HTTPException(400, "This company's GLEIF candidates come from the GLEIF file.")
        return gleif_api.enqueue(conn, c)


@app.get("/api/network/verdicts.csv")
def network_verdicts_csv() -> Response:
    with db.connect() as conn:
        body = network.verdicts_csv(conn)
    return Response(body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="gleif_verdicts.csv"'})
