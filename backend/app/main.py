from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db, gleif, loader


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.connect() as conn:
        db.init_schema(conn)
        loader.seed_demo(conn)      # first start only: the 4 demo companies
        gleif.refresh_all(conn)     # every start: re-read the GLEIF files (verdicts are edited in the CSV)
    yield


app = FastAPI(title="Geographic Supplier Risk Intelligence", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
