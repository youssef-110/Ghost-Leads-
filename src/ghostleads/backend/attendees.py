"""Second lead source: people who say on LinkedIn they attend an event (post authors and "see you there" commenters).

Event card (events/<slug>.json) -> Needle post search -> comments -> OpenAI filter (event match + attendance,
0-100 each) -> attendees table (keep / review / discard, with reason). Kept people can be promoted into `leads`.

Usage:
  python -m ghostleads.backend.attendees search events/web-summit-2026.json [--pages 1] [--comment-posts 10]
  python -m ghostleads.backend.attendees promote events/web-summit-2026.json [--limit 20]
"""
import argparse
import json
from pathlib import Path

from openai import OpenAI

from ghostleads import db
from ghostleads.backend import enrich, needle
from ghostleads.backend.config import connect, key

MODEL = "gpt-4.1-mini"
KEEP, REVIEW = 70, 40  # brief's starting cut-offs: both >=70 keep, any <40 discard, else review
TABLE = """CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  person_name TEXT, headline TEXT, public_id TEXT NOT NULL, linkedin_url TEXT,
  signal TEXT,                 -- author | commenter
  post_url TEXT, post_text TEXT, comment_text TEXT, posted_at TEXT,
  event_score INTEGER, attend_score INTEGER,
  decision TEXT,               -- keep | review | discard
  reason TEXT,
  lead_id INTEGER,             -- set when promoted into leads
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_name, public_id)
)"""
PROMPT = """You filter LinkedIn activity for one event. Event card:
{card}

For each item decide:
- event_score 0-100: is it about THIS event (name or hashtag, this year's dates, this city)? Other editions
  (other cities, past years), lookalike events and generic mentions score low.
- attend_score 0-100: is THIS person actually going (attending, speaking, exhibiting, "see you there",
  "let's meet there")? The person is the post author, or the commenter when a comment is given.
  Recaps of past editions, "wish I could go", "can't make it", questions like "anyone going?",
  and the organiser's own ads or ticket promos score low. For a commenter, only the comment's own words count:
  "see you there", "attending again", "let's grab a coffee at the event" score high; generic praise or
  congratulations ("great post", "you're a star") score 50 at most, even when the post itself is about the event.
- reason: one short sentence citing the words that decided it.
Return JSON: {{"items": [{{"id": <id>, "event_score": <int>, "attend_score": <int>, "reason": "<text>"}}]}}
with one entry for every id."""


def decide(e, a):
    if e >= KEEP and a >= KEEP:
        return "keep"
    if e < REVIEW or a < REVIEW:
        return "discard"
    return "review"


def _person(au, **rest):
    return dict(public_id=au["publicIdentifier"], person_name=au.get("name"), headline=au.get("headline"), **rest)


def collect(card, pages, comment_posts):
    """Return (candidates, posts_in_window): one candidate per person, from post search plus comments."""
    acc = needle.linkedin_account()
    posts, seen = [], set()
    for term in card["search_terms"]:
        cursor = None
        for _ in range(pages):
            r = needle.call("needleSearchLinkedinPosts", connectedAccountId=acc, keywords=term, limit=49,
                            **({"cursor": cursor} if cursor else {}))
            for p in r.get("posts", []):
                if p["postId"] not in seen and (p.get("postedAt") or "") >= card["window_start"]:
                    seen.add(p["postId"])
                    posts.append(p)
            cursor = r.get("cursor")
            if not cursor:
                break
    cands = {}
    for p in posts:
        au = p.get("author") or {}
        if au.get("publicIdentifier") and not au.get("isCompany"):
            cands.setdefault(au["publicIdentifier"], _person(
                au, signal="author", post_url=p.get("url"), post_text=p.get("text"), comment_text=None,
                posted_at=p.get("postedAt")))
    # commenters on the most discussed posts: "see you there" commenters are confirmed attendees too
    names = [n.lower() for n in card["variants"] + card["hashtags"]]
    on_topic = [p for p in posts if p.get("commentCount") and any(n in (p.get("text") or "").lower() for n in names)]
    for p in sorted(on_topic, key=lambda p: -p["commentCount"])[:comment_posts]:
        for cm in needle.call("needleListLinkedinPostComments", connectedAccountId=acc,
                              postId=p["postId"]).get("comments", []):
            au = {"publicIdentifier": cm.get("authorIdentity"), "name": cm.get("authorName"),
                  "headline": cm.get("authorHeadline")}  # comments carry flat author fields
            if au["publicIdentifier"] and au["publicIdentifier"] not in cands:
                cands[au["publicIdentifier"]] = _person(
                    au, signal="commenter", post_url=p.get("url"), post_text=p.get("text"),
                    comment_text=cm.get("text"), posted_at=cm.get("createdAt") or p.get("postedAt"))
    return list(cands.values()), len(posts)


def score(card, cands, batch=20):
    client = OpenAI(api_key=key("OPENAI_API_KEY"))
    card_txt = json.dumps({k: card[k] for k in ("name", "variants", "hashtags", "start", "end", "city",
                                                 "not_this_event")}, ensure_ascii=False)
    for i in range(0, len(cands), batch):
        chunk = cands[i:i + batch]
        items = [{"id": j, "posted_at": c["posted_at"], "post": (c["post_text"] or "")[:1200],
                  **({"comment": c["comment_text"][:500]} if c["comment_text"] else {})}
                 for j, c in enumerate(chunk)]
        r = client.chat.completions.create(
            model=MODEL, temperature=0, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": PROMPT.format(card=card_txt)},
                      {"role": "user", "content": json.dumps(items, ensure_ascii=False)}])
        out = {int(o["id"]): o for o in json.loads(r.choices[0].message.content).get("items", [])}
        for j, c in enumerate(chunk):
            o = out.get(j, {"event_score": 0, "attend_score": 0, "reason": "not scored by the model"})
            e, a = int(o["event_score"]), int(o["attend_score"])
            c.update(event_score=e, attend_score=a, reason=o["reason"], decision=decide(e, a))


def search(card, pages, comment_posts):
    conn = connect()
    conn.execute(TABLE)
    cands, n_posts = collect(card, pages, comment_posts)
    known = {r[0] for r in conn.execute("SELECT public_id FROM attendees WHERE event_name=?", (card["name"],))}
    new = [c for c in cands if c["public_id"] not in known]  # never score the same person twice
    score(card, new)
    for c in new:
        cols = ["event_name", "linkedin_url", *c]
        conn.execute(f"INSERT OR IGNORE INTO attendees ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                     [card["name"], f"https://www.linkedin.com/in/{c['public_id']}", *c.values()])
    conn.commit()
    tally = dict(conn.execute("SELECT decision, COUNT(*) FROM attendees WHERE event_name=? GROUP BY 1",
                              (card["name"],)).fetchall())
    print(f"{n_posts} posts in window, {len(cands)} people, {len(new)} newly scored. Totals: {tally}")


def promote(card, limit):
    """Kept attendees -> leads rows (company + domain via Blitz), stage scraped, owner = the attendee."""
    conn = connect()
    conn.execute(TABLE)
    todo = conn.execute("SELECT * FROM attendees WHERE event_name=? AND decision='keep' AND lead_id IS NULL "
                        "ORDER BY attend_score DESC, id LIMIT ?", (card["name"], limit)).fetchall()
    done = 0
    with enrich.blitz() as c:
        for a in todo:
            p = enrich._post(c, "/v2/enrichment/person", {"person_linkedin_url": a["linkedin_url"]})
            p = p.get("person") or p
            job = next((e for e in p.get("experiences") or [] if e.get("job_is_current")), None)
            if not job or not job.get("company_linkedin_url"):
                print(f"  skip {a['person_name']}: no current company")
                continue
            domain = job.get("company_domain") or enrich._post(
                c, "/v2/enrichment/linkedin-to-domain", {"company_linkedin_url": job["company_linkedin_url"]}
            ).get("email_domain")
            if not domain:
                print(f"  skip {a['person_name']}: no company domain")
                continue
            domain = domain.lower().removeprefix("www.").strip("/")
            if domain in card["url"]:  # organiser staff promote their own event; not a buyer
                conn.execute("UPDATE attendees SET decision='discard', reason='works for the organiser' WHERE id=?",
                             (a["id"],))
                conn.commit()
                print(f"  skip {a['person_name']}: organiser staff")
                continue
            db.upsert_scraped(conn, event_name=card["name"], event_url=card["url"], source_url=a["post_url"],
                              company_name=job["company_name"], domain=domain,
                              owner_name=a["person_name"], owner_title=job.get("job_title") or a["headline"])
            lead = conn.execute("SELECT id FROM leads WHERE event_name=? AND domain=?",
                                (card["name"], domain)).fetchone()["id"]
            db.update(conn, lead, linkedin_url=a["linkedin_url"])  # the attendee, not a waterfall pick
            conn.execute("UPDATE attendees SET lead_id=? WHERE id=?", (lead, a["id"]))
            conn.commit()
            done += 1
            print(f"  {a['person_name']} -> {job['company_name']} ({domain})")
    print(f"promoted {done}/{len(todo)} kept attendees into leads")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["search", "promote"])
    ap.add_argument("card", type=Path)
    ap.add_argument("--pages", type=int, default=1)
    ap.add_argument("--comment-posts", type=int, default=10)
    ap.add_argument("--limit", type=int, default=20)
    a = ap.parse_args(argv)
    card = json.loads(a.card.read_text(encoding="utf-8"))
    if a.cmd == "search":
        search(card, a.pages, a.comment_posts)
    else:
        promote(card, a.limit)


if __name__ == "__main__":
    main()
