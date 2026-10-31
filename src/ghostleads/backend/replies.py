"""Step 9: replies and meeting booking (stage sent -> replied -> booked). A person approves every reply and invite.

  python -m ghostleads.backend replies sync      # pull accepts and replies from Needle, classify replies
  python -m ghostleads.backend replies paste 12 "Klingt gut, gerne!"   # when a reply came in elsewhere
The dashboard drafts a slot proposal for interested leads and books a confirmed time as an .ics invite.
Never book anyone who has not agreed to a time.
"""
import argparse
import json
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from openai import OpenAI

from ghostleads import db
from ghostleads.backend import draft, needle, send, verify
from ghostleads.backend.config import ROOT, SEED_EVENT, connect, key

MODEL = "gpt-4.1-mini"
CLASSES = ("interested", "not_interested", "question", "later")

class ReplyConflict(ValueError):
    """Inbound evidence needs manual review; do not classify or promote this lead."""


def classify(text):
    r = OpenAI(api_key=key("OPENAI_API_KEY")).chat.completions.create(
        model=MODEL, temperature=0, response_format={"type": "json_object"},
        messages=[{"role": "system", "content":
                   "Classify a reply to a LinkedIn outreach note. interested = wants to meet or talk; "
                   "not_interested = declines or asks to stop; question = asks something before deciding; "
                   'later = not now, maybe another time. Return JSON: {"class": "<one>"}.'},
                  {"role": "user", "content": text}])
    c = json.loads(r.choices[0].message.content).get("class")
    return c if c in CLASSES else "question"


def _update_reply_if_unchanged(conn, lead_id, r, **fields):
    """Write inbound evidence only if the row still matches the pre-classification read."""
    sets = ",".join(f"{column}=?" for column in fields)
    changed = conn.execute(
        f"UPDATE leads SET {sets},updated_at=CURRENT_TIMESTAMP "
        "WHERE id=? AND event_name IS ? AND stage IS ? AND in_aiark IS ? "
        "AND needle_status IS ? AND reply_text IS NULL AND reply_class IS ?",
        (*fields.values(), lead_id, r["event_name"], r["stage"], r["in_aiark"],
         r["needle_status"], r["reply_class"]),
    ).rowcount
    conn.commit()
    return changed == 1


def record_reply(conn, lead_id, text):
    r = conn.execute("SELECT event_name, stage, in_aiark, needle_status, reply_text, reply_class FROM leads WHERE id=?",
                     (lead_id,)).fetchone()
    if r is None:
        raise ValueError(f"lead {lead_id} does not exist")
    if r["event_name"] == SEED_EVENT:
        raise ValueError("SEED replies cannot be recorded")
    if r["reply_text"] is not None:
        raise ReplyConflict("reply already recorded; do not overwrite inbound evidence")
    if r["stage"] != "sent" or r["in_aiark"] == 1 or r["needle_status"] not in ("sent", "accepted"):
        # Retain inbound evidence on a real, unresponded-to lead, without
        # promoting an unsafe row or letting it enter automatic reply handling.
        if r["stage"] in ("replied", "booked"):
            raise ReplyConflict(f"lead {lead_id}: already past sent stage; review inbound reply manually")
        status = "sent_conflict" if r["needle_status"] in ("sent", "accepted", "sent_conflict") else "reply_conflict"
        if not _update_reply_if_unchanged(conn, lead_id, r, reply_text=text, needle_status=status):
            raise ReplyConflict(f"lead {lead_id}: inbound state changed; manual review required")
        raise ReplyConflict(f"lead {lead_id}: inbound reply saved for manual review; unsafe AI Ark/stage/send state")
    c = classify(text)
    if not _update_reply_if_unchanged(conn, lead_id, r, reply_text=text, reply_class=c,
                                       needle_status="replied", stage="replied"):
        raise ReplyConflict(f"lead {lead_id}: inbound state changed; manual review required")
    return c


def sync(conn):
    """Accepted invitations and inbound messages from Needle's lead events."""
    todo = conn.execute("SELECT * FROM leads WHERE needle_status IN ('sent','accepted') AND reply_text IS NULL"
                        " AND linkedin_url IS NOT NULL AND event_name<>?", (SEED_EVENT,)).fetchall()
    seen = {"accepted": 0, "replied": 0, "conflict": 0}
    for r in todo:
        events = needle.call("needleListLeadEvents", leadId=send.needle_lead(r), limit=100).get("events", [])
        inbound = [e for e in events if any(k in e["type"] for k in ("received", "repl", "inbound"))
                   and (e.get("data") or {}).get("text")]
        if inbound:
            text = sorted(inbound, key=lambda e: e["occurredAt"])[0]["data"]["text"]
            try:
                result = record_reply(conn, r["id"], text)
            except ReplyConflict as exc:
                print(f"  conflict [{r['id']}]: {exc}")
                seen["conflict"] += 1
                continue
            print(f"  [{r['id']}] {r['owner_name']}: {result}")
            seen["replied"] += 1
        elif r["needle_status"] == "sent" and any("accept" in e["type"] for e in events):
            changed = conn.execute(
                "UPDATE leads SET needle_status='accepted', updated_at=CURRENT_TIMESTAMP "
                "WHERE id=? AND event_name<>? AND stage='sent' AND COALESCE(in_aiark, 0)=0 "
                "AND needle_status='sent' AND reply_text IS NULL AND reply_class IS NULL",
                (r["id"], SEED_EVENT),
            ).rowcount
            conn.commit()
            seen["accepted"] += changed
    print(f"checked {len(todo)} sent leads: {seen}")


def slots(card):
    """Meeting slots from the event card (marketer edits them there)."""
    return card.get("meeting_slots") or []


def propose(conn, r):
    """Draft a reply that offers the card's slots. Returns text for a person to edit and approve."""
    card = draft.event_card(r["event_name"]) or {}
    cfg = json.loads((ROOT / "outreach.json").read_text(encoding="utf-8"))
    lang = "German, formal Sie" if r["domain"].rsplit(".", 1)[-1] in ("de", "at", "ch") else "English"
    offer = slots(card)
    ask = (f"offer these times at {card.get('meeting_point') or r['event_name']}: {', '.join(offer)}"
           if offer and card.get("end", "") >= datetime.now().date().isoformat()
           else "suggest a short video call and ask which day suits them")
    out = OpenAI(api_key=key("OPENAI_API_KEY")).chat.completions.create(
        model=MODEL, temperature=0.3,
        messages=[{"role": "system", "content":
                   f"Write a short LinkedIn reply in {lang} from {cfg['sender_name']} ({cfg['sender_company']}). "
                   f"Thank them, {ask}, ask them to pick one. Max 400 characters. No invented facts."},
                  {"role": "user", "content": f"Their reply: {r['reply_text']}\nOur first note: {r['message']}"}])
    return out.choices[0].message.content.strip()


def _text(v):
    """RFC 5545 TEXT escaping; lead fields are scraped, so no raw CR/LF may reach the file."""
    v = str(v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return v.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "")


def _param(v):
    """Quoted parameter value (CN): no quotes, control characters or line breaks."""
    return '"' + "".join(ch for ch in str(v or "") if ch not in '"\r\n' and ord(ch) >= 32) + '"'


def ics(r, start, minutes, location, organizer_email=None):
    """iCalendar invite text for a confirmed meeting."""
    uid = f"{uuid.uuid4()}@ghostleads"
    fmt = "%Y%m%dT%H%M%SZ"
    s = start.astimezone(ZoneInfo("UTC"))
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ghost Leads//EN", "METHOD:REQUEST", "BEGIN:VEVENT",
             f"UID:{uid}", f"DTSTAMP:{datetime.now(ZoneInfo('UTC')).strftime(fmt)}", f"DTSTART:{s.strftime(fmt)}",
             f"DTEND:{(s + timedelta(minutes=minutes)).strftime(fmt)}",
             "SUMMARY:" + _text(f"Coffee at {r['event_name']}: {r['owner_name']} ({r['company_name']})"),
             "LOCATION:" + _text(location),
             "DESCRIPTION:" + _text(f"Booked via Ghost Leads. Lead {r['linkedin_url'] or ''}")]
    if r["email"] and verify.EMAIL.match(r["email"]):
        lines.append(f"ATTENDEE;CN={_param(r['owner_name'])};RSVP=TRUE:mailto:{r['email']}")
    if organizer_email and verify.EMAIL.match(organizer_email):
        lines.append(f"ORGANIZER:mailto:{organizer_email}")
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return uid, "\r\n".join(lines) + "\r\n"


def book(conn, lead_id, start, location, minutes=15):
    """Only call after the lead confirmed this exact time. Writes data/ics/<id>.ics and sets stage booked."""
    r = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    if r["reply_class"] != "interested":
        raise ValueError("book only leads whose reply is classified interested and who confirmed a time")
    uid, text = ics(r, start, minutes, location)
    path = ROOT / "data" / "ics" / f"lead-{lead_id}.ics"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="")
    db.update(conn, lead_id, meeting_start=start.isoformat(), meeting_location=location,
              calendar_event_id="ics:" + uid, stage="booked")
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m ghostleads.backend replies")
    ap.add_argument("cmd", choices=["sync", "paste"])
    ap.add_argument("lead_id", nargs="?", type=int)
    ap.add_argument("text", nargs="?")
    a = ap.parse_args(argv)
    conn = connect()
    if a.cmd == "sync":
        return sync(conn)
    if not (a.lead_id and a.text):
        raise SystemExit("paste needs: <lead_id> \"<reply text>\"")
    print(record_reply(conn, a.lead_id, a.text))


if __name__ == "__main__":
    main()
