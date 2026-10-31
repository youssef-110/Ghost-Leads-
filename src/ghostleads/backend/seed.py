"""Insert 20 labelled fake rows (event_name=SEED) to develop against before scraping lands.

Usage: python -m ghostleads.backend.seed
"""
from ghostleads import db
from ghostleads.backend.config import SEED_EVENT, connect


def main():
    conn = connect()
    for i in range(1, 21):
        db.upsert_scraped(
            conn,
            event_name=SEED_EVENT,
            company_name=f"Seed Company {i:02d} GmbH",
            domain=f"seed-{i:02d}.example",  # .example is reserved, never a real company
            impressum_url=f"https://seed-{i:02d}.example/impressum",
            owner_name=f"Seed Owner {i:02d}",
            owner_title="Geschäftsführer",
            owner_email=f"owner@seed-{i:02d}.example",
            owner_phone=f"+49 30 0000{i:02d}",
        )
    n = conn.execute("SELECT COUNT(*) FROM leads WHERE event_name=?", (SEED_EVENT,)).fetchone()[0]
    print(f"{n} SEED rows in {conn.execute('PRAGMA database_list').fetchone()[2]}")


if __name__ == "__main__":
    main()
