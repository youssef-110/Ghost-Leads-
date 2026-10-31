"""Run the generic scraper: python -m ghostleads.scraping run --event-url ..."""
from __future__ import annotations

import argparse
import sys

from dotenv import load_dotenv

from ghostleads import db
from .adapter import extract_event_page
from .enrich import bare_domain, resolve_domain, extract_impressum


def run(
    event_url: str,
    event_name: str,
    *,
    limit: int | None = None,
    owner_limit: int = 30,
) -> tuple[int, int, int]:
    load_dotenv()
    exhibitors = extract_event_page(event_url, event_url=event_url)
    if limit is not None:
        exhibitors = exhibitors[:limit]
    with_domain = with_owner = 0
    owners_checked = 0
    conn = db.connect()
    try:
        for company in exhibitors:
            domain = bare_domain(company.website_url) or resolve_domain(
                company.company_name, event_name=event_name
            )
            if not domain:
                continue
            if owners_checked < owner_limit:
                impressum_url, contact = extract_impressum(domain)
                owners_checked += 1
            else:
                impressum_url = None
                contact = {key: None for key in ("owner_name", "owner_title", "owner_email", "owner_phone")}
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
    print(
        f"Found: {found}; with domain: {with_domain}; with owner: {with_owner}; "
        f"owner domains checked: {owners_checked}"
    )
    return found, with_domain, with_owner


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m ghostleads.scraping")
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("run")
    command.add_argument("--event-url", required=True)
    command.add_argument("--event-name", required=True)
    command.add_argument("--limit", type=int, help="maximum number of extracted companies to process")
    command.add_argument("--owner-limit", type=int, default=30, help="maximum domains to scan for Impressum contacts")
    args = parser.parse_args()
    if args.command == "run":
        if args.limit is not None and args.limit < 1:
            parser.error("--limit must be at least 1")
        if args.owner_limit < 0:
            parser.error("--owner-limit must be zero or greater")
        try:
            run(args.event_url, args.event_name, limit=args.limit, owner_limit=args.owner_limit)
        except Exception as exc:
            print(f"scraping failed: {exc}", file=sys.stderr)
            raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
