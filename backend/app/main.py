import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db, gleif, hazards, loader


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.connect() as conn:
        db.init_schema(conn)
        loader.seed_demo(conn)      # first start only: the 4 demo companies
        gleif.refresh_all(conn)     # every start: re-read the GLEIF files (verdicts are edited in the CSV)
    task = asyncio.create_task(_refresh_hazards())   # every start: one GDACS refresh in the background
    yield
    task.cancel()


app = FastAPI(title="Geographic Supplier Risk Intelligence", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


async def _refresh_hazards() -> dict:
    with db.connect() as conn:
        return await hazards.refresh(conn)


@app.post("/api/hazards/refresh")
async def refresh_hazards() -> dict:
    """List current GDACS events and store the affected areas of new or changed events."""
    return await _refresh_hazards()
