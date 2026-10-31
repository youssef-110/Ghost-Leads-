"""Env loading and shared DB access for the backend."""
import os
from pathlib import Path

from dotenv import load_dotenv

from ghostleads import db

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")
SEED_EVENT = "SEED"  # seed rows: never counted in demo numbers


def key(name):
    """Return a required API key from .env, or stop with a clear message."""
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is missing in .env (ask the team, do not invent one)")
    return value


def connect():
    return db.connect(os.getenv("GL_DB") or str(ROOT / "data" / "ghostleads.db"))


def rows(conn, stage, include_seed=False, **where):
    """Rows at a stage, real events only unless include_seed. Extra equality filters via kwargs."""
    sql, args = "SELECT * FROM leads WHERE stage=?", [stage]
    if not include_seed:
        sql += " AND event_name<>?"
        args.append(SEED_EVENT)
    for col, val in where.items():
        sql += f" AND {col} IS ?"
        args.append(val)
    return conn.execute(sql + " ORDER BY id", args).fetchall()
