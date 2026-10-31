"""Enrich ghosts (in_aiark=0, stage deduped): Blitz decision maker + LinkedIn + email, AI Ark phone for the top N,
Impressum fields as fallback. Sets enrichment_source and stage enriched.

Usage: python -m ghostleads.backend.enrich [--limit N] [--phones N] [--include-seed]
Budget: Blitz ~3 records per lead (1,000/month free). AI Ark phone = 5 credits per hit, misses free.
"""
import argparse
import time

import httpx

from ghostleads import db
from ghostleads.backend import aiark
from ghostleads.backend.config import connect, key, rows

BLITZ = "https://api.blitz-api.ai"
CASCADE = [  # tier 1 = owner/MD, tier 2 = IT or commercial lead
    {"include_title": ["Geschäftsführer", "Geschäftsführerin", "Inhaber", "Inhaberin", "CEO", "Managing Director",
                       "Founder", "Gründer", "Owner", "Vorstand"],
     "exclude_title": ["assistant", "assistenz", "intern", "werkstudent"]},
    {"include_title": ["CTO", "Head of IT", "IT-Leiter", "Prokurist", "Partner", "Head of Sales", "Vertriebsleiter"],
     "exclude_title": ["assistant", "assistenz", "intern", "werkstudent"]},
]
PHONE_CREDIT_FLOOR = 40  # keep AI Ark credits for dedupe


def blitz():
    return httpx.Client(base_url=BLITZ, timeout=30, headers={"x-api-key": key("BLITZ_API_KEY")})


def _post(c, path, body):
    for attempt in range(4):
        r = c.post(path, json=body)
        if r.status_code == 429:  # 5 req/s per endpoint on the trial
            time.sleep(1 + attempt)
            continue
        if r.status_code == 404:
            return {}
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def decision_maker(c, domain):
    """Return (person dict or None) for the best owner/MD at the company behind domain."""
    co = _post(c, "/v2/enrichment/domain-to-linkedin", {"domain": domain})
    if not co.get("found"):
        return None
    res = _post(c, "/v2/search/waterfall-icp-keyword",
                {"company_linkedin_url": co["company_linkedin_url"], "cascade": CASCADE, "max_results": 1})
    hits = res.get("results") or []
    if not hits:
        return None
    p = hits[0]["person"]
    title = next((e["job_title"] for e in p.get("experiences") or [] if e.get("job_is_current")), p.get("headline"))
    return {"name": p.get("full_name"), "title": title, "linkedin_url": p.get("linkedin_url"),
            "country": (p.get("location") or {}).get("country_code")}


def work_email(c, linkedin_url):
    return _post(c, "/v2/enrichment/email", {"person_linkedin_url": linkedin_url}).get("email")


def phone(c, linkedin_url):
    """AI Ark mobile finder (replaces Lusha). 404 = not found, free."""
    r = c.post("/v1/people/mobile-phone-finder", json={"linkedin": linkedin_url})
    if r.status_code == 404:
        return None
    r.raise_for_status()
    nums = [n for group in r.json().get("data") or [] for n in group]
    return nums[0] if nums else None


def enrich_row(c, r):
    fields = {"stage": "enriched"}
    if r["linkedin_url"]:  # attendee rows already name the person; only find their email
        return {**fields, "enrichment_source": "blitz", "email": work_email(c, r["linkedin_url"]) or r["owner_email"],
                "phone": r["owner_phone"]}
    p = decision_maker(c, r["domain"])
    if p and p["linkedin_url"]:
        fields.update(linkedin_url=p["linkedin_url"], enrichment_source="blitz",
                      email=work_email(c, p["linkedin_url"]) or r["owner_email"],
                      phone=r["owner_phone"])
        if not r["owner_name"]:  # scraped owner wins; fill only gaps
            fields.update(owner_name=p["name"], owner_title=p["title"])
    else:
        fields.update(enrichment_source="impressum" if r["owner_name"] else None,
                      email=r["owner_email"], phone=r["owner_phone"])
    return fields


def add_phones(conn, n):
    if n <= 0:
        return 0
    todo = conn.execute("SELECT id, linkedin_url FROM leads WHERE stage='enriched' AND in_aiark=0 "
                        "AND linkedin_url IS NOT NULL AND phone IS NULL ORDER BY id LIMIT ?", (n,)).fetchall()
    found = 0
    with aiark.client() as c:
        for r in todo:
            bal = aiark.credits(c)
            if not isinstance(bal, dict) or bal.get("total", 0) < PHONE_CREDIT_FLOOR:
                print(f"phones stopped: AI Ark credits {bal}")
                break
            num = phone(c, r["linkedin_url"])
            if num:
                db.update(conn, r["id"], phone=num)
                found += 1
            time.sleep(0.25)
    return found


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--phones", type=int, default=5, help="AI Ark phone lookups for the first N (5 credits per hit)")
    ap.add_argument("--include-seed", action="store_true")
    a = ap.parse_args(argv)

    conn = connect()
    # ghosts, plus rows AI Ark could not check (in_aiark NULL); rows already in AI Ark are skipped
    ghosts = (rows(conn, "deduped", a.include_seed, in_aiark=0)
              + rows(conn, "deduped", a.include_seed, in_aiark=None))[: a.limit]
    with blitz() as c:
        for r in ghosts:
            f = enrich_row(c, r)
            db.update(conn, r["id"], **f)
            print(f"  {r['domain']:<24} {f.get('enrichment_source') or 'none':<9} "
                  f"{f.get('owner_name') or r['owner_name'] or '-'} | {f.get('linkedin_url') or '-'} | {f.get('email') or '-'}")
    phones = add_phones(conn, a.phones)
    with_person = sum(1 for r in ghosts if conn.execute(
        "SELECT linkedin_url FROM leads WHERE id=?", (r["id"],)).fetchone()[0])
    print(f"enriched {len(ghosts)} ghosts: {with_person} with person + LinkedIn, {phones} phones added")


if __name__ == "__main__":
    main()
