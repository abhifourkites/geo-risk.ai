from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db, loader


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.connect() as conn:
        db.init_schema(conn)
        loader.seed_demo(conn)      # first start only: the 4 demo companies
    yield


app = FastAPI(title="Geographic Supplier Risk Intelligence", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
