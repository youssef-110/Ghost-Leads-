"""Run the generic scraper: python -m ghostleads.scraping run --event-url ..."""
from __future__ import annotations

import argparse
import sys

from dotenv import load_dotenv

from ghostleads import db
from .adapter import extract_event_page
from .enrich import bare_domain, resolve_domain, extract_impressum


def run(event_url: str, event_name: str) -> tuple[int, int, int]:
    load_dotenv()
    exhibitors = extract_event_page(event_url, event_url=event_url)
    with_domain = with_owner = 0
    conn = db.connect()
    try:
        for company in exhibitors:
            domain = bare_domain(company.website_url) or resolve_domain(company.company_name)
            if not domain:
                continue
            impressum_url, contact = extract_impressum(domain)
            db.upsert_scraped(
                conn,
                event_name=event_name,
                event_url=event_url,
                source_url=company.source_url,
                company_name=company.company_name,
                domain=domain,
                impressum_url=impressum_url,
                **contact,
            )
            with_domain += 1
            with_owner += bool(contact.get("owner_name"))
            print(f"{company.company_name}: {domain}" + (" (owner found)" if contact.get("owner_name") else ""))
    finally:
        conn.close()
    found = len(exhibitors)
    print(f"Found: {found}; with domain: {with_domain}; with owner: {with_owner}")
    return found, with_domain, with_owner


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m ghostleads.scraping")
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("run")
    command.add_argument("--event-url", required=True)
    command.add_argument("--event-name", required=True)
    args = parser.parse_args()
    if args.command == "run":
        try:
            run(args.event_url, args.event_name)
        except Exception as exc:
            print(f"scraping failed: {exc}", file=sys.stderr)
            raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
