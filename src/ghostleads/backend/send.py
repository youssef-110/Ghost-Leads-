"""Needle sender (stage drafted -> sent). Sending requires human review:

  python -m ghostleads.backend.send                  # dry run (default): print what would go out
  python -m ghostleads.backend.send --draft          # disabled: requires reviewed snapshot API
  python -m ghostleads.backend.send --send --ids 4,7 # disabled: bypasses exact-text approval
  python -m ghostleads.backend.send sync             # pull draft results from Needle: sent / failed
Each exact note must be reviewed and approved in Needle before it can send.
"""
import argparse
import json
import re
from contextlib import closing
from urllib.parse import urlsplit

import httpx

from ghostleads import db
from ghostleads.backend import needle
from ghostleads.backend.config import SEED_EVENT, connect, key, rows

REVIEW_FIELDS = ("id", "event_name", "company_name", "domain", "owner_name", "linkedin_url", "message")


def _linkedin_profile(url):
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
        return (parts.scheme == "https" and parts.hostname in ("www.linkedin.com", "linkedin.com")
                and parts.port is None and not parts.username and not parts.password
                and not parts.query and not parts.fragment
                and bool(re.fullmatch(r"/in/[a-zA-Z0-9_.%-]+/?", parts.path)))
    except ValueError:
        return False


def _create_draft_once(**args):
    """Non-idempotent tool: send ONE HTTP request, including on 429/timeout."""
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "needleCreateDraft", "arguments": args}}
    with httpx.Client(timeout=90, headers={
        "Authorization": f"Bearer {key('NEEDLE_API_KEY')}",
        "Content-Type": "application/json", "Accept": "application/json, text/event-stream",
    }) as client:
        response = client.post(needle.URL, json=body)
        response.raise_for_status()
        text = response.text
    if not text.lstrip().startswith("{"):
        text = [line[5:] for line in text.splitlines() if line.startswith("data:")][-1]
    msg = json.loads(text)
    if "error" in msg:
        raise ValueError("Needle draft response reported an error")
    result = msg["result"]
    if result.get("isError"):
        raise ValueError("Needle draft tool reported an error")
    payload = result["content"][0]["text"] if result.get("content") else "{}"
    return json.loads(payload)


def create_reviewed_draft(lead_id, expected_snapshot):
    """Claim exactly one reviewed recipient and message before any provider request.

    expected_snapshot is the seven-field REVIEW_FIELDS tuple from the review UI.
    A claimed attempt is NEVER retried automatically, even if the provider or
    local persistence fails: reconcile it manually with Needle first.
    Returns the persisted ``draft:<provider-id>`` reference on success.
    """
    if (type(lead_id) is not int or not isinstance(expected_snapshot, (tuple, list))
            or len(expected_snapshot) != len(REVIEW_FIELDS)
            or type(expected_snapshot[0]) is not int or expected_snapshot[0] != lead_id
            or any(not isinstance(v, str) or not v.strip() for v in expected_snapshot[1:])
            or not _linkedin_profile(expected_snapshot[5])):
        raise ValueError("A full reviewed recipient and exact message snapshot is required")

    with closing(connect()) as conn:
        # The UPDATE is a SQLite compare-and-swap. Commit the durable claim
        # before account discovery, upsert or the non-idempotent draft call.
        try:
            claimed = conn.execute(
                "UPDATE leads SET needle_status='draft_creating', updated_at=CURRENT_TIMESTAMP "
                "WHERE id=? AND event_name<>? AND stage='drafted' AND in_aiark=0 "
                "AND needle_ref IS NULL AND needle_status='pending' "
                + "".join(f"AND {col} IS ? " for col in REVIEW_FIELDS[1:])
                + "RETURNING *",
                (lead_id, SEED_EVENT, *expected_snapshot[1:]),
            )
            row = claimed.fetchone()
            if row is None or claimed.fetchone() is not None:
                conn.rollback()
                raise ValueError("Lead changed, is ineligible, or already has a Needle draft claim; refresh review")
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        try:
            account = needle.linkedin_account()
            provider_lead = needle_lead(row)
            result = _create_draft_once(connectedAccountId=account, leadId=provider_lead,
                                        action="linkedin_invitation", text=row["message"])
            draft = result.get("draft") or result
            draft_id = draft.get("id") if isinstance(draft, dict) else None
            if not isinstance(draft_id, str) or not draft_id.strip():
                raise ValueError("Needle draft response has no valid reference")
            reference = "draft:" + draft_id
            saved = conn.execute(
                "UPDATE leads SET needle_ref=?, needle_status='pending', updated_at=CURRENT_TIMESTAMP "
                "WHERE id=? AND stage='drafted' AND in_aiark=0 "
                "AND needle_status='draft_creating' AND needle_ref IS NULL "
                + "".join(f"AND {col} IS ? " for col in REVIEW_FIELDS[1:]),
                (reference, lead_id, *expected_snapshot[1:]),
            )
            if saved.rowcount != 1:
                raise RuntimeError("Needle draft claim changed during persistence")
            conn.commit()
            return reference
        except (Exception, SystemExit):
            conn.rollback()
            # If this update also fails, the original durable draft_creating
            # claim still prevents another provider request.
            try:
                conn.execute("UPDATE leads SET needle_status='draft_reconcile', updated_at=CURRENT_TIMESTAMP "
                             "WHERE id=? AND needle_status='draft_creating' AND needle_ref IS NULL", (lead_id,))
                conn.commit()
            except Exception:
                conn.rollback()
            raise RuntimeError("Needle draft outcome needs manual reconciliation; do not retry") from None


def public_id(url):
    return url.rstrip("/").split("/in/")[-1]


def needle_lead(r):
    first, _, last = (r["owner_name"] or "").partition(" ")
    lead = needle.call("needleUpsertLead", identities={"linkedin": public_id(r["linkedin_url"])},
                       timezone="Europe/Berlin", firstName=first, lastName=last or first,
                       companyName=r["company_name"], companyDomain=r["domain"],
                       **({"jobTitle": r["owner_title"][:256]} if r["owner_title"] else {}),
                       properties={"event": r["event_name"], "ghost_leads_id": str(r["id"])})
    return (lead.get("lead") or lead)["id"]


def sync(conn):
    """Sync external facts; quarantine sent drafts with an unsafe local AI Ark state."""
    todo = conn.execute("SELECT id, needle_ref, in_aiark, stage FROM leads WHERE needle_ref LIKE 'draft:%' "
                        "AND needle_status='pending' AND event_name<>?", (SEED_EVENT,)).fetchall()
    moved = {}
    for r in todo:
        d = needle.call("needleGetDraft", draftId=r["needle_ref"][6:])
        st = (d.get("draft") or d).get("status")
        if st == "sent":
            # Provider lookup is outside the transaction: recheck current
            # eligibility atomically, not the row fetched before the HTTP call.
            saved = conn.execute(
                "UPDATE leads SET needle_status='sent', stage='sent', updated_at=CURRENT_TIMESTAMP "
                "WHERE id=? AND needle_ref=? AND needle_status='pending' "
                "AND event_name<>? AND stage='drafted' AND in_aiark=0",
                (r["id"], r["needle_ref"], SEED_EVENT),
            )
            conn.commit()
            if saved.rowcount != 1:
                # The external send is real, but do not promote an unsafe row.
                conflict = conn.execute(
                    "UPDATE leads SET needle_status='sent_conflict', updated_at=CURRENT_TIMESTAMP "
                    "WHERE id=? AND needle_ref=? AND needle_status='pending'",
                    (r["id"], r["needle_ref"]),
                )
                conn.commit()
                if conflict.rowcount == 1:
                    print(f"  conflict [{r['id']}]: Needle reports sent, but local AI Ark/stage is unsafe; review manually")
                    st = "sent_conflict"
                else:
                    st = "changed_during_sync"
        elif st in ("failed", "discarded"):
            db.update(conn, r["id"], needle_status="failed")
        moved[st] = moved.get(st, 0) + 1
    print(f"synced {len(todo)} drafts: {moved}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="push", choices=["push", "sync"])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--draft", action="store_true", help="disabled; review exact recipient and text in dashboard")
    mode.add_argument("--send", action="store_true", help="disabled; approve exact text in Needle instead")
    ap.add_argument("--ids", help="comma-separated lead ids to draft or preview")
    ap.add_argument("--limit", type=int, default=20)
    a = ap.parse_args(argv)
    if a.send:
        raise SystemExit("Direct send disabled: review and approve exact text in Needle")
    if a.draft:
        raise SystemExit("CLI draft creation disabled: use dashboard review and create_reviewed_draft")
    conn = connect()
    if a.cmd == "sync":
        return sync(conn)

    todo = [r for r in rows(conn, "drafted", in_aiark=0) if r["message"] and not r["needle_ref"]]
    if a.ids:
        wanted = {int(i) for i in a.ids.split(",")}
        todo = [r for r in todo if r["id"] in wanted]
    todo = todo[: a.limit]
    for r in todo:
        print(f"--- [{r['id']}] {r['owner_name']} ({r['company_name']}) {r['linkedin_url']}\n{r['message']}")
    print(f"dry run: {len(todo)} notes; queue only through dashboard review (no bulk CLI drafting).")


if __name__ == "__main__":
    main()
