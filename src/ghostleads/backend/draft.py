"""Personalization (stage verified -> drafted): a short LinkedIn connection note per lead, stored in `message`.

Facts allowed: the event, the company, the person's title, and (for attendee leads) their own post or comment.
German for .de/.at/.ch companies, English otherwise. Notes stay under outreach.json max_chars (LinkedIn free
accounts cut notes at 200 characters).
Usage: python -m ghostleads.backend.draft [--limit N] [--redo] [--include-seed]
"""
import argparse
import json
from datetime import date

from openai import OpenAI

from ghostleads import db
from ghostleads.backend.config import ROOT, connect, key, rows

MODEL = "gpt-4.1-mini"
PROMPT = """Write a LinkedIn connection-request note from {sender_name} ({sender_company}) to the person below.
Today is {today}.
Rules:
- {language}. Exactly three short lines separated by line breaks; the greeting starts line 1. Aim for 160
  characters, never more than {max_chars} in total.
- Line 1: greeting plus the event and one concrete fact from FACTS (their post, their role, or their company).
- Line 2 says in plain words what {sender_company} does: "{offer}"
- Line 3: {ask}
- Use only facts given. Never invent numbers, mutual contacts, products or claims. No emojis, no hashtags,
  no "I hope this finds you well". Never claim you met, saw or talked to them.
Return only the note text."""


def language(domain):
    return 'Write in German, formal Sie, greeting "Guten Tag <full name>,"' \
        if domain.rsplit(".", 1)[-1] in ("de", "at", "ch") else "Write in English, greeting by first name"


def event_card(name):
    """The matching event card in events/, if one exists."""
    for p in (ROOT / "events").glob("*.json"):
        card = json.loads(p.read_text(encoding="utf-8"))
        if card["name"] == name:
            return card
    return None


def ask(cfg, card):
    if card and card["end"] >= date.today().isoformat():
        return f"ask for {cfg['meeting_ask']}."
    return "speak of the event in the past tense (e.g. 'after the event') and ask for a short call."


def facts(conn, r):
    card = event_card(r["event_name"])
    f = {"event": r["event_name"], "event_dates": card and f"{card['start']} to {card['end']}, {card['city']}",
         "company": r["company_name"], "name": r["owner_name"], "title": r["owner_title"]}
    att = conn.execute("SELECT signal, post_text, comment_text FROM attendees WHERE lead_id=?", (r["id"],)).fetchone() \
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='attendees'").fetchone() else None
    if att:  # their own words are the strongest hook
        f["their_" + ("comment" if att["signal"] == "commenter" else "post")] = \
            (att["comment_text"] or att["post_text"] or "")[:800]
    return {k: v for k, v in f.items() if v}


def write_note(client, cfg, conn, r):
    system = PROMPT.format(language=language(r["domain"]), today=date.today().isoformat(),
                           ask=ask(cfg, event_card(r["event_name"])), **cfg)
    msgs = [{"role": "system", "content": system},
            {"role": "user", "content": "FACTS:\n" + json.dumps(facts(conn, r), ensure_ascii=False)}]
    for _ in range(4):
        text = client.chat.completions.create(model=MODEL, temperature=0.4, messages=msgs) \
            .choices[0].message.content.strip().strip('"')
        text = "\n".join(ln.strip() for ln in text.splitlines() if ln.strip())
        if len(text) <= cfg["max_chars"]:
            return text
        msgs += [{"role": "assistant", "content": text},
                 {"role": "user", "content": f"That is {len(text)} characters. Rewrite it under "
                                             f"{cfg['max_chars'] - 20} characters: cut words, keep the three lines."}]
    return None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--redo", action="store_true", help="rewrite notes only before a Needle draft/lead exists")
    ap.add_argument("--include-seed", action="store_true")
    a = ap.parse_args(argv)
    cfg = json.loads((ROOT / "outreach.json").read_text(encoding="utf-8"))
    conn = connect()
    todo = rows(conn, "verified", a.include_seed, in_aiark=0) + (rows(conn, "drafted", a.include_seed, in_aiark=0) if a.redo else [])
    # LinkedIn is the channel: a lead without a profile cannot get a note
    todo = [r for r in todo if r["needle_ref"] is None and r["needle_status"] == "pending"
            and r["linkedin_url"] and r["owner_name"]][: a.limit]
    if not todo:
        print("drafted 0/0")
        return
    client = OpenAI(api_key=key("OPENAI_API_KEY"))
    done = 0
    for r in todo:
        note = write_note(client, cfg, conn, r)
        if not note:
            print(f"  {r['domain']}: note too long after 4 tries, skipped")
            continue
        # The provider may claim a reviewed snapshot while the note is being
        # generated. Never rewrite text or stage after that durable claim.
        changed = conn.execute(
            "UPDATE leads SET message=?, stage='drafted', updated_at=CURRENT_TIMESTAMP "
            "WHERE id=? AND stage=? AND in_aiark=0 AND needle_ref IS NULL "
            "AND needle_status='pending' AND message IS ? AND owner_name IS ? AND linkedin_url IS ?",
            (note, r["id"], r["stage"], r["message"], r["owner_name"], r["linkedin_url"]),
        )
        conn.commit()
        if changed.rowcount != 1:
            print(f"  [{r['id']}]: lead changed or a Needle claim began; skipped")
            continue
        done += 1
        print(f"--- {r['owner_name']} ({r['company_name']}), {len(note)} chars\n{note}")
    print(f"drafted {done}/{len(todo)}")


if __name__ == "__main__":
    main()
