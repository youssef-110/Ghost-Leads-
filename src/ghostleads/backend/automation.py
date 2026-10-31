"""Dashboard-facing, opt-in backend orchestration.

run_stages only checks/enriches/verifies/drafts. It never queues or sends
outreach: a human must review the exact note in Needle before it is sent.
Provider connectivity is not inferred from the presence of API keys; health is
local-only and status reads persisted rows, excluding SEED.
"""
import os
import sqlite3
from pathlib import Path

from ghostleads import db
from ghostleads.backend import aiark, draft, enrich, replies, send, verify
from ghostleads.backend.config import ROOT, SEED_EVENT, connect

STAGES = ("dedupe", "enrich", "verify", "draft")
ALIASES = {"deduped": "dedupe", "enriched": "enrich", "verified": "verify", "drafted": "draft"}
KEYS = ("AIARK_API_KEY", "BLITZ_API_KEY", "OPENAI_API_KEY", "NEEDLE_API_KEY")


def _path():
    return Path(os.getenv("GL_DB") or ROOT / "data" / "ghostleads.db").resolve()


def health():
    """Local database/credential presence only; no API calls or database creation."""
    path = _path()
    result = {"database": "missing", "keys": {name: bool(os.getenv(name, "").strip()) for name in KEYS}}
    if path.is_file():
        try:
            with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as conn:
                conn.execute("SELECT id FROM leads LIMIT 1")
            result["database"] = "ready"
        except sqlite3.Error:
            result["database"] = "invalid"
    return result


def status(conn=None):
    """Snapshot persisted lead counts (not cumulative estimates), excluding SEED."""
    owned = conn is None
    if owned:
        path = _path()
        if not path.is_file():
            raise FileNotFoundError("Ghost Leads database is missing; check health() first")
        conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    try:
        records = conn.execute(
            "SELECT stage, in_aiark, needle_status, needle_ref FROM leads WHERE event_name<>?",
            (SEED_EVENT,),
        ).fetchall()
        return {
            "total": len(records),
            "stages": {stage: sum(r[0] == stage for r in records) for stage in db.STAGES},
            "aiark": {
                "ghost": sum(r[1] == 0 for r in records),
                "in_database": sum(r[1] == 1 for r in records),
                "unchecked": sum(r[1] is None for r in records),
            },
            "needle": {
                "pending_drafts": sum(r[3] is not None and r[3].startswith("draft:") and r[2] == "pending" for r in records),
                "sent": sum(r[2] == "sent" for r in records),
                "sent_conflict": sum(r[2] == "sent_conflict" for r in records),
                "reply_conflict": sum(r[2] == "reply_conflict" for r in records),
                "accepted": sum(r[2] == "accepted" for r in records),
                "replied": sum(r[2] == "replied" for r in records),
                "failed": sum(r[2] == "failed" for r in records),
            },
        }
    finally:
        if owned:
            conn.close()


def _stages(stages):
    names = (stages,) if isinstance(stages, str) else tuple(stages)
    if not names:
        raise ValueError("select at least one stage")
    if names == ("all",):
        return STAGES
    names = tuple(ALIASES.get(name, name) for name in names)
    if any(name not in STAGES for name in names) or tuple(sorted(names, key=STAGES.index)) != names or len(set(names)) != len(names):
        raise ValueError("stages must be unique, ordered dedupe → enrich → verify → draft; sending is not available")
    return names


def run_stages(stages, *, limit=None, phones=0):
    """Run selected stages in order; never queue/send. Stop on blocked or stalled work.

    No automatic AI Ark bypass. Enrichment requires every deduped row to have
    been checked; provider-specific CLI output may contain details, but return
    values always reflect actual DB changes. Default phones=0 saves AI Ark calls.
    """
    names = _stages(stages)
    if limit is not None and (type(limit) is not int or limit < 1):
        raise ValueError("limit must be a positive integer")
    if type(phones) is not int or phones < 0:
        raise ValueError("phones must be a nonnegative integer")
    args = ["--limit", str(limit)] if limit is not None else []
    conn = connect()
    try:
        before = status(conn)
        completed, skipped = [], []
        stopped = None
        steps = {"dedupe": aiark.main, "enrich": enrich.main, "verify": verify.main, "draft": draft.main}
        for name in names:
            source = {"enrich": "deduped", "verify": "enriched", "draft": "verified"}.get(name)
            if source and conn.execute(
                "SELECT 1 FROM leads WHERE event_name<>? AND stage=? AND in_aiark IS NULL LIMIT 1",
                (SEED_EVENT, source),
            ).fetchone():
                stopped = f"{name}: AI Ark check pending for {source} rows"
                break
            pending = {
                "dedupe": "stage='scraped' OR (in_aiark IS NULL AND stage<>'scraped')",
                "enrich": "stage='deduped' AND in_aiark=0",
                "verify": "stage='enriched' AND in_aiark=0",
                "draft": "stage='verified' AND in_aiark=0 AND linkedin_url IS NOT NULL AND owner_name IS NOT NULL",
            }[name]
            count = conn.execute(
                f"SELECT COUNT(*) FROM leads WHERE event_name<>? AND ({pending})", (SEED_EVENT,),
            ).fetchone()[0]
            if not count:
                skipped.append(name)
                continue
            previous = status(conn)
            try:
                steps[name](args + (["--phones", str(phones)] if name == "enrich" else []))
            except (Exception, SystemExit) as exc:
                # A CLI missing-key SystemExit or provider failure must not
                # advance the pipeline. Do not return exception strings: HTTP
                # errors may include credential-bearing request data.
                stopped = f"{name}: failed ({type(exc).__name__}); no later stages run"
                break
            current = status(conn)
            progress = (current["aiark"]["unchecked"] < previous["aiark"]["unchecked"]
                        or current["stages"] != previous["stages"])
            if not progress:
                stopped = f"{name}: no progress; check provider output/status"
                break
            completed.append(name)
        return {"completed": completed, "skipped": skipped, "stopped": stopped,
                "before": before, "after": status(conn)}
    finally:
        conn.close()


def sync(kind, *, conn=None):
    """Explicitly pull either Needle draft statuses or inbound replies (API calls).

    This never approves a draft, sends a note, replies to a lead, or books a
    meeting. A requested sync can use Needle calls; do not poll on page reruns.
    """
    if kind not in ("drafts", "replies"):
        raise ValueError("kind must be 'drafts' or 'replies'")
    owned = conn is None
    if owned:
        conn = connect()
    try:
        before = status(conn)
        (send.sync if kind == "drafts" else replies.sync)(conn)
        return {"kind": kind, "before": before, "after": status(conn)}
    finally:
        if owned:
            conn.close()
