"""Shared SQLite contract between scraping and backend. See schema.sql."""
import os
import sqlite3
from pathlib import Path

STAGES = ("scraped", "deduped", "enriched", "verified", "drafted", "sent", "replied", "booked")
SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"
SCRAPED_FIELDS = (
    "event_name", "event_url", "source_url", "company_name", "domain",
    "impressum_url", "owner_name", "owner_title", "owner_email", "owner_phone",
)


def connect(path=None):
    path = path or os.getenv("GL_DB", "data/ghostleads.db")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn


def upsert_scraped(conn, **row):
    """Insert a scraped lead. Existing rows only get their empty scraped fields filled."""
    row["domain"] = row["domain"].lower().removeprefix("www.").strip("/")
    cols = [c for c in SCRAPED_FIELDS if row.get(c) is not None]
    conn.execute(
        f"INSERT INTO leads ({','.join(cols)}) VALUES ({','.join('?' * len(cols))}) "
        "ON CONFLICT(event_name, domain) DO UPDATE SET "
        + ",".join(f"{c}=COALESCE({c},excluded.{c})" for c in cols if c not in ("event_name", "domain"))
        + ",updated_at=CURRENT_TIMESTAMP",
        [row[c] for c in cols],
    )
    conn.commit()


def by_stage(conn, stage):
    return conn.execute("SELECT * FROM leads WHERE stage=?", (stage,)).fetchall()


def update(conn, lead_id, **fields):
    if "stage" in fields and fields["stage"] not in STAGES:
        raise ValueError(f"unknown stage {fields['stage']!r}")
    sets = ",".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE leads SET {sets},updated_at=CURRENT_TIMESTAMP WHERE id=?", [*fields.values(), lead_id])
    conn.commit()
