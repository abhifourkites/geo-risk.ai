from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.connect() as conn:
        db.init_schema(conn)
    yield


app = FastAPI(title="Geographic Supplier Risk Intelligence", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
