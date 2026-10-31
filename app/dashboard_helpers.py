"""Pure, local-only dashboard data helpers. No provider requests on page load."""
from __future__ import annotations

import csv
import io
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit

STAGES = ("scraped", "deduped", "enriched", "verified", "drafted", "sent", "replied", "booked")


def load_snapshot(path: Path) -> dict:
    """Read persisted rows without creating a missing database or tables."""
    path = Path(path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Database missing: {path}")
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        leads = [dict(r) for r in conn.execute("SELECT * FROM leads WHERE event_name<>? ORDER BY id DESC", ("SEED",))]
        has_attendees = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='attendees'").fetchone()
        attendees = ([dict(r) for r in conn.execute("SELECT * FROM attendees WHERE event_name<>? ORDER BY id DESC", ("SEED",))]
                     if has_attendees else [])
    return {"leads": leads, "attendees": attendees}


def summarize(leads: list[dict], attendees: list[dict]) -> dict:
    """Exact stages are exclusive; a draft is not a sent contact."""
    return {
        "total": len(leads),
        "stages": {s: sum(r["stage"] == s for r in leads) for s in STAGES},
        "ghost": sum(r["in_aiark"] == 0 for r in leads),
        "checked": sum(r["in_aiark"] is not None for r in leads),
        "valid_emails": sum(r["email_status"] == "valid" for r in leads),
        "queued": sum(bool(r["needle_ref"] and str(r["needle_ref"]).startswith("draft:")) for r in leads),
        "refs_on_unchecked": sum(bool(r["needle_ref"] and str(r["needle_ref"]).startswith("draft:")
                                      and r["in_aiark"] is None) for r in leads),
        "sent": sum(r["needle_status"] == "sent" for r in leads),
        "attendees": len(attendees),
        "kept": sum(r["decision"] == "keep" for r in attendees),
        "review": sum(r["decision"] == "review" for r in attendees),
    }


def filter_leads(leads: list[dict], *, events: set[str] | None = None, stage: str = "All",
                 search: str = "", aiark: str = "All") -> list[dict]:
    needle = search.strip().casefold()

    def matches(row: dict) -> bool:
        if events is not None and row["event_name"] not in events:
            return False
        if stage != "All" and row["stage"] != stage:
            return False
        if aiark == "Ghost" and row["in_aiark"] != 0:
            return False
        if aiark == "In AI Ark" and row["in_aiark"] != 1:
            return False
        if aiark == "Unchecked" and row["in_aiark"] is not None:
            return False
        return not needle or any(needle in str(row.get(key) or "").casefold()
                                 for key in ("company_name", "domain", "owner_name", "event_name"))

    return [row for row in leads if matches(row)]


def review_identity(row: dict) -> tuple:
    """All persisted recipient and note fields the operator must approve together."""
    return tuple(row.get(key) for key in ("id", "event_name", "company_name", "domain",
                                           "owner_name", "linkedin_url", "message"))

def linkedin_profile(url: str) -> bool:
    """Accept only a direct HTTPS LinkedIn person profile, not a redirect URL."""
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
        return bool(parts.scheme == "https" and parts.hostname in ("www.linkedin.com", "linkedin.com")
                    and parts.port is None and not parts.username and not parts.password
                    and not parts.query and not parts.fragment
                    and re.fullmatch(r"/in/[a-zA-Z0-9_.%-]+/?", parts.path))
    except ValueError:
        return False


def queue_eligible(row: dict, *, approved: bool, reviewed_message: str,
                   reviewed_identity: tuple) -> bool:
    """Only queue a draft whose recipient and exact text still match the review."""
    return bool(approved and review_identity(row) == reviewed_identity
                and row.get("event_name") != "SEED" and row.get("stage") == "drafted" and row.get("in_aiark") == 0
                and not row.get("needle_ref") and row.get("needle_status") == "pending"
                and row.get("message") and row["message"] == reviewed_message
                and all(isinstance(v, str) and v.strip() for v in reviewed_identity[1:])
                and linkedin_profile(row.get("linkedin_url")))


EXPORT_COLUMNS = ("id", "event_name", "company_name", "domain", "stage", "in_aiark",
                  "owner_name", "email_status", "needle_status", "last_error")


def csv_export(leads: list[dict]) -> str:
    """Export only operational fields; neutralize spreadsheet formulas in untrusted input."""
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(EXPORT_COLUMNS)
    for row in leads:
        cells = []
        for key in EXPORT_COLUMNS:
            value = str(row.get(key) if row.get(key) is not None else "")
            if value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value
            cells.append(value)
        writer.writerow(cells)
    return output.getvalue()
