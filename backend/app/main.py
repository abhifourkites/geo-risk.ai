from fastapi import FastAPI

app = FastAPI(title="Geographic Supplier Risk Intelligence")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
