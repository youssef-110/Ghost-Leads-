"""Email verification (stage enriched -> verified): sets email_status valid | invalid | unknown.

valid   = Blitz reverse lookup knows a person behind the address (Blitz only stores verified emails)
invalid = bad syntax or the domain has no MX record
unknown = no email, or a mail domain exists but nobody confirms the mailbox
Usage: python -m ghostleads.backend.verify [--limit N] [--include-seed]
"""
import argparse
import re

import httpx

from ghostleads import db
from ghostleads.backend import enrich
from ghostleads.backend.config import connect, rows

EMAIL = re.compile(r"^[^@\s]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$")


def has_mx(domain):
    """MX lookup over DNS-over-HTTPS, so no extra dependency. None = lookup failed."""
    try:
        r = httpx.get("https://dns.google/resolve", params={"name": domain, "type": "MX"}, timeout=10)
        return bool(r.json().get("Answer"))
    except (httpx.HTTPError, ValueError):
        return None


def status(c, email):
    if not email:
        return "unknown"
    if not EMAIL.match(email):
        return "invalid"
    if enrich._post(c, "/v2/enrichment/email-to-person", {"email": email}).get("found"):
        return "valid"
    mx = has_mx(email.split("@")[1])
    return "invalid" if mx is False else "unknown"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--include-seed", action="store_true")
    a = ap.parse_args(argv)
    conn = connect()
    todo = rows(conn, "enriched", a.include_seed, outreachable=True)[: a.limit]
    counts = {}
    if todo:
        with enrich.blitz() as c:
            for r in todo:
                s = status(c, r["email"])
                db.update(conn, r["id"], email_status=s, stage="verified")
                counts[s] = counts.get(s, 0) + 1
                print(f"  {r['domain']:<24} {s:<8} {r['email'] or '-'}")
    print(f"verified {len(todo)}: {counts}")


if __name__ == "__main__":
    main()
