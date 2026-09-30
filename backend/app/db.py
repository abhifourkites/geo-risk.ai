import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://georisk:georisk@db:5432/georisk")
SCHEMA = Path(__file__).with_name("schema.sql")


def connect(url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(url or DATABASE_URL, row_factory=dict_row)


def init_schema(conn: psycopg.Connection) -> None:
    """Create the tables if they do not exist. Safe to run on every start."""
    with conn.cursor() as cur:
        cur.execute(SCHEMA.read_text())
    conn.commit()
