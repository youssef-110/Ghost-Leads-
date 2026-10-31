"""Bridge between the hosted app (Supabase) and the local pipeline.

  python -m ghostleads.cloud publish --workspace "Arvana"   # push local real rows into a workspace
  python -m ghostleads.cloud worker [--once]                # run jobs queued from the web app

The worker authenticates with GL_WORKER_SECRET (only its hash is stored in Supabase), so no service key is needed.
Jobs: attendee_search (Needle search + promote for one event), pipeline (dedupe -> enrich -> verify -> draft),
queue_drafts (Needle drafts for the leads a member approved; nothing sends until approved in Needle), sync.
"""
import argparse
import time
from datetime import date, timedelta

import httpx

from ghostleads.backend import aiark, attendees, draft, enrich, replies, send, verify
from ghostleads.backend.config import SEED_EVENT, connect, key

LEAD_COLS = ("event_name", "company_name", "domain", "owner_name", "owner_title", "linkedin_url", "email",
             "email_status", "in_aiark", "stage", "needle_status", "message", "source_url", "reply_class",
             "meeting_start", "meeting_location")
ATT_COLS = ("event_name", "person_name", "headline", "linkedin_url", "signal", "decision", "event_score",
            "attend_score", "reason", "post_url")


def rpc(fn, **args):
    r = httpx.post(f"{key('SUPABASE_URL')}/rest/v1/rpc/{fn}", timeout=60,
                   headers={"apikey": key("SUPABASE_ANON_KEY"), "Content-Type": "application/json"},
                   json={"secret": key("GL_WORKER_SECRET"), **args})
    r.raise_for_status()
    return r.json() if r.content else None


def push(ws, events):
    """Upsert local rows of the given events into workspace ws. Returns counts."""
    conn = connect()
    conn.execute(attendees.TABLE)
    marks = ",".join("?" * len(events))
    leads = [dict(zip(LEAD_COLS, r)) for r in conn.execute(
        f"SELECT {','.join(LEAD_COLS)} FROM leads WHERE event_name IN ({marks}) AND event_name<>?",
        (*events, SEED_EVENT))]
    atts = [dict(zip(ATT_COLS, r)) for r in conn.execute(
        f"SELECT {','.join(ATT_COLS)} FROM attendees WHERE event_name IN ({marks})", events)]
    return rpc("gl_worker_push", ws=ws, leads=leads, attendees=atts)


def pull_messages(ws):
    """Notes edited in the web app replace local notes that are not queued in Needle yet."""
    conn = connect()
    allowed = set(workspace_events(ws))
    for m in rpc("gl_worker_messages", ws=ws) or []:
        if m.get("event_name") not in allowed:
            continue
        conn.execute("UPDATE leads SET message=?, updated_at=CURRENT_TIMESTAMP WHERE event_name=? AND domain=? "
                     "AND needle_ref IS NULL AND message IS NOT ?", (m["message"], m["event_name"], m["domain"],
                                                                     m["message"]))
    conn.commit()


def card_from(event):
    """Event card for attendees.search from a gl_events row."""
    start = event.get("start_date") or date.today().isoformat()
    return {"name": event["name"], "variants": [event["name"]], "hashtags": [], "start": start,
            "end": event.get("end_date") or start, "city": event.get("city") or "", "url": event.get("url") or "",
            "window_start": (date.fromisoformat(start) - timedelta(days=45)).isoformat(),
            "not_this_event": [], "search_terms": event.get("search_terms") or [f'"{event["name"]}"']}


def workspace_events(ws):
    """Event names this workspace owns (events table) plus events it already has leads for."""
    return sorted(rpc("gl_worker_ws_events", ws=ws) or [])


def run_job(job):
    ws, kind, p = job["workspace_id"], job["kind"], job.get("payload") or {}
    if kind == "attendee_search":
        event = rpc("gl_worker_event", ws=ws, event_name=p["event"])
        if not event:
            raise ValueError("event not found in this workspace")
        card = card_from(event)
        attendees.search(card, 1, int(p.get("comment_posts", 3)))
        attendees.promote(card, int(p.get("limit", 10)))
        return push(ws, [card["name"]])
    # never trust event names from the job payload: only events this workspace owns may be read or pushed
    allowed = set(workspace_events(ws))
    events = [e for e in (p.get("events") or allowed) if e in allowed]
    if kind == "pipeline":
        pull_messages(ws)
        aiark.main(["--skip-if-blocked"])
        enrich.main(["--phones", "0"])
        verify.main([])
        draft.main([])
    elif kind == "queue_drafts":
        pull_messages(ws)
        conn = connect()
        done = 0
        for lead_id in p.get("lead_ids", []):
            if not isinstance(lead_id, dict) or lead_id.get("event_name") not in allowed:
                continue  # another workspace's lead
            r = conn.execute(f"SELECT {','.join(send.REVIEW_FIELDS)} FROM leads l WHERE event_name=? AND domain=?",
                             (lead_id["event_name"], lead_id["domain"])).fetchone()
            if r:
                send.create_reviewed_draft(r[0], tuple(r))  # the member approved this exact text in the app
                done += 1
        return {"queued": done, **(push(ws, events) or {})}
    elif kind == "sync":
        conn = connect()
        send.sync(conn)
        replies.sync(conn)
    return push(ws, events)


def worker(once=False):
    print("worker running; waiting for jobs from the web app")
    while True:
        jobs = rpc("gl_worker_claim") or []
        for job in jobs:
            print(f"job {job['id']} {job['kind']} {job.get('payload')}")
            try:
                rpc("gl_worker_finish", job_id=job["id"], ok=True, res=run_job(job) or {})
            except (Exception, SystemExit) as e:  # report, never crash the loop
                rpc("gl_worker_finish", job_id=job["id"], ok=False, res={"error": type(e).__name__, "detail": str(e)[:300]})
                print(f"  failed: {type(e).__name__}: {e}")
        if once:
            return
        time.sleep(3 if jobs else 5)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m ghostleads.cloud")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pub = sub.add_parser("publish")
    pub.add_argument("--workspace", required=True, help="workspace name or id")
    w = sub.add_parser("worker")
    w.add_argument("--once", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "worker":
        return worker(a.once)
    spaces = rpc("gl_worker_workspaces") or []
    ws = next((s["id"] for s in spaces if a.workspace in (s["id"], s["name"])), None)
    if not ws:
        raise SystemExit(f"no workspace {a.workspace!r}; sign up in the web app first. Known: {[s['name'] for s in spaces]}")
    conn = connect()
    events = [r[0] for r in conn.execute("SELECT DISTINCT event_name FROM leads WHERE event_name<>?", (SEED_EVENT,))]
    print(push(ws, events))


if __name__ == "__main__":
    main()
