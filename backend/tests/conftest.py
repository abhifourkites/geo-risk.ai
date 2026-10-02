"""Test setup: a separate database (georisk_test) on the same PostGIS server, seeded from the committed
demo files only (data/demo, data/reference). No GDACS call is made: hazard tests use hand-made data."""
import os

import psycopg
import pytest

MAIN_URL = os.environ.get("DATABASE_URL", "postgresql://georisk:georisk@db:5432/georisk")
TEST_DB = "georisk_test"
TEST_URL = MAIN_URL.rsplit("/", 1)[0] + "/" + TEST_DB
os.environ["DATABASE_URL"] = TEST_URL          # before the app is imported: app.db reads it at import

from app import db, gleif, gleif_api, hazards, loader  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def seeded_db():
    with psycopg.connect(MAIN_URL, autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        admin.execute(f"CREATE DATABASE {TEST_DB}")
    with db.connect(TEST_URL) as conn:
        db.init_schema(conn)
        loader.seed_demo(conn)
        gleif.refresh_all(conn)
    yield


@pytest.fixture
def conn():
    with db.connect(TEST_URL) as c:
        yield c


@pytest.fixture(autouse=True)
def no_gleif_worker(monkeypatch):
    """Tests never call GLEIF: the background worker is off when a test runs the app's start-up
    (test_gleif_api.py runs the jobs itself, against a fake GLEIF)."""
    async def off():
        return None
    monkeypatch.setattr(gleif_api, "worker", off)


@pytest.fixture
def hazard_status():
    """Restore the in-process GDACS status after a test that changes it."""
    saved = dict(hazards.STATUS)
    yield hazards.STATUS
    hazards.STATUS.clear()
    hazards.STATUS.update(saved)
