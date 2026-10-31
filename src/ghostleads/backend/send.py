"""Needle sender (stage drafted -> sent). Three modes, safest first:

  python -m ghostleads.backend.send                  # dry run (default): print what would go out
  python -m ghostleads.backend.send --draft          # create Needle drafts; NOTHING sends until a person
                                                     #   approves each one in the Needle inbox
  python -m ghostleads.backend.send --send --ids 4,7 # send connection requests now, only the listed ids
  python -m ghostleads.backend.send sync             # pull draft results from Needle: sent / failed
Real sends need the team's OK on the exact messages first.
"""
import argparse

from ghostleads import db
from ghostleads.backend import needle
from ghostleads.backend.config import connect, rows


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
    """Move drafts that a person approved in Needle to sent; mark failed/discarded ones."""
    todo = conn.execute("SELECT id, needle_ref FROM leads WHERE needle_ref LIKE 'draft:%' "
                        "AND needle_status='pending'").fetchall()
    moved = {}
    for r in todo:
        d = needle.call("needleGetDraft", draftId=r["needle_ref"][6:])
        st = (d.get("draft") or d).get("status")
        if st == "sent":
            db.update(conn, r["id"], needle_status="sent", stage="sent")
        elif st in ("failed", "discarded"):
            db.update(conn, r["id"], needle_status="failed")
        moved[st] = moved.get(st, 0) + 1
    print(f"synced {len(todo)} drafts: {moved}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="push", choices=["push", "sync"])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--draft", action="store_true", help="create drafts for review in the Needle inbox")
    mode.add_argument("--send", action="store_true", help="send now; requires --ids")
    ap.add_argument("--ids", help="comma-separated lead ids (required with --send)")
    ap.add_argument("--limit", type=int, default=20)
    a = ap.parse_args(argv)
    conn = connect()
    if a.cmd == "sync":
        return sync(conn)

    todo = [r for r in rows(conn, "drafted") if r["message"] and not r["needle_ref"]]
    if a.ids:
        wanted = {int(i) for i in a.ids.split(",")}
        todo = [r for r in todo if r["id"] in wanted]
    elif a.send:
        raise SystemExit("--send needs --ids: list the exact leads the team approved")
    todo = todo[: a.limit]
    if not (a.draft or a.send):
        for r in todo:
            print(f"--- [{r['id']}] {r['owner_name']} ({r['company_name']}) {r['linkedin_url']}\n{r['message']}")
        print(f"dry run: {len(todo)} notes would go out. Use --draft to queue them for review in Needle.")
        return

    acc = needle.linkedin_account()
    ok = 0
    for r in todo:
        try:
            if a.draft:
                d = needle.call("needleCreateDraft", connectedAccountId=acc, leadId=needle_lead(r),
                                action="linkedin_invitation", text=r["message"])
                db.update(conn, r["id"], needle_ref="draft:" + (d.get("draft") or d)["id"])
            else:
                res = needle.call("needleSendLinkedinInvitation", connectedAccountId=acc,
                                  identity=public_id(r["linkedin_url"]), note=r["message"])
                db.update(conn, r["id"], needle_status="sent", stage="sent",
                          needle_ref="invite:" + str(res.get("invitationId") or res.get("requestId") or ""))
            ok += 1
            print(f"  ok [{r['id']}] {r['owner_name']}")
        except Exception as e:  # one bad profile must not stop the batch
            db.update(conn, r["id"], needle_status="failed")
            print(f"  failed [{r['id']}] {r['owner_name']}: {e}")
    print(f"{'drafted in Needle' if a.draft else 'sent'}: {ok}/{len(todo)}")


if __name__ == "__main__":
    main()
