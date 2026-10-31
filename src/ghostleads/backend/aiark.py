"""AI Ark check: is each scraped company already in AI Ark? Sets in_aiark, aiark_checked_at, stage deduped.

Usage:
  python -m ghostleads.backend.aiark [--limit N] [--include-seed]
  python -m ghostleads.backend.aiark --domains acme.de,other.com   # ad-hoc check, no DB writes
Caveat: a miss means "not found by domain", not "not in AI Ark at all".
"""
import argparse
import time
from datetime import datetime, timezone

import httpx

from ghostleads import db
from ghostleads.backend.config import connect, key, rows

BASE = "https://api.ai-ark.com/api/developer-portal"
BATCH = 100  # docs allow 300 domains per filter, but a page returns max 100 companies


def norm(domain):
    d = (domain or "").lower().strip().removeprefix("https://").removeprefix("http://")
    return d.split("/")[0].removeprefix("www.")


def _post(client, body):
    for attempt in range(5):
        r = client.post("/v1/companies", json=body)
        if r.status_code == 429:  # limit is 5 req/s per key
            time.sleep(1 + attempt)
            continue
        if r.status_code == 404:
            return {"content": []}
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def client():
    return httpx.Client(
        base_url=BASE, timeout=30,
        headers={"X-TOKEN": key("AIARK_API_KEY"), "Content-Type": "application/json"},
    )


def credits(c):
    r = c.get("/v1/payments/credits")
    return r.json() if r.is_success else f"HTTP {r.status_code}"


def found_domains(c, domains):
    """Return the subset of domains AI Ark returns a company for (exact domain match only)."""
    found, wanted = set(), {norm(d) for d in domains}
    for i in range(0, len(domains), BATCH):
        chunk = sorted({norm(d) for d in domains[i:i + BATCH]})
        page = 0
        while True:
            data = _post(c, {"account": {"domain": {"any": {"include": chunk}}}, "page": page, "size": 100})
            content = data.get("content") or []
            found |= {norm((co.get("link") or {}).get("domain")) for co in content} & wanted
            if len(content) < 100 or page + 1 >= data.get("totalPages", page + 2):
                break
            page += 1
            time.sleep(0.25)
        time.sleep(0.25)
    return found


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--include-seed", action="store_true")
    ap.add_argument("--domains", help="comma-separated ad-hoc check, no DB writes")
    ap.add_argument("--skip-if-blocked", action="store_true",
                    help="if AI Ark refuses API access, pass rows on as 'not checked' (in_aiark NULL), never as ghosts")
    a = ap.parse_args(argv)

    with client() as c:
        probe = c.get("/v1/payments/credits")
        if probe.status_code in (401, 403) or (probe.status_code == 429 and "not included" in probe.text):
            print(f"AI Ark unavailable: HTTP {probe.status_code} {probe.text[:120]}")
            if a.skip_if_blocked and not a.domains:
                conn = connect()
                leads = rows(conn, "scraped", a.include_seed)[: a.limit]
                for r in leads:
                    db.update(conn, r["id"], stage="deduped")  # in_aiark stays NULL = not checked
                print(f"passed {len(leads)} rows on unchecked; rerun dedupe when AI Ark works")
            return
        print("credits before:", credits(c))
        if a.domains:
            domains = [norm(d) for d in a.domains.split(",") if d.strip()]
            hits = found_domains(c, domains)
            for d in domains:
                print(f"  {'IN AI ARK' if d in hits else 'GHOST    '}  {d}")
        else:
            conn = connect()
            # scraped rows, plus rows passed on unchecked while AI Ark was blocked
            late = [r for s in db.STAGES[1:] for r in rows(conn, s, a.include_seed, aiark_checked_at=None)]
            leads = (rows(conn, "scraped", a.include_seed) + late)[: a.limit]
            domains = [r["domain"] for r in leads]
            hits = found_domains(c, domains) if domains else set()
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            for r in leads:
                f = {"in_aiark": int(norm(r["domain"]) in hits), "aiark_checked_at": now}
                db.update(conn, r["id"], **f, **({"stage": "deduped"} if r["stage"] == "scraped" else {}))
        print("credits after:", credits(c))
    n = len(domains)
    if n:
        print(f"checked {n}: {len(hits)} in AI Ark, {n - len(hits)} ghosts, overlap {len(hits) / n:.0%}")
    else:
        print("nothing at stage scraped")


if __name__ == "__main__":
    main()
