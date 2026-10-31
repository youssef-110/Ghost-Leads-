"""Focused, offline dashboard data and approval safeguards."""
import sqlite3
from contextlib import closing
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.dashboard_helpers import load_snapshot, summarize, filter_leads, queue_eligible, review_identity, csv_export  # noqa: E402


class DashboardHelpersTests(unittest.TestCase):
    def test_snapshot_excludes_seed_and_counts_exact_stages(self):
        with tempfile.TemporaryDirectory(dir=Path.home() / "AppData" / "Local" / "hermes" / "cache" / "scratch") as folder:
            path = Path(folder) / "leads.db"
            with closing(sqlite3.connect(path)) as conn:
                conn.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
                conn.executemany("INSERT INTO leads (event_name,company_name,domain,stage,in_aiark,message) VALUES (?,?,?,?,?,?)", [
                    ("SEED", "Fake", "fake.test", "sent", 0, "fake"),
                    ("Event A", "One", "one.test", "deduped", 0, None),
                    ("Event A", "Two", "two.test", "drafted", None, "hello"),
                ])
                conn.execute("UPDATE leads SET needle_ref='draft:local' WHERE domain='two.test'")
                conn.commit()
            data = load_snapshot(path)
            summary = summarize(data["leads"], data["attendees"])
            self.assertEqual(summary["total"], 2)
            self.assertEqual(summary["stages"]["sent"], 0)
            self.assertEqual(summary["stages"]["drafted"], 1)
            self.assertEqual(summary["ghost"], 1)
            self.assertEqual(summary["queued"], 1)
            self.assertEqual(summary["refs_on_unchecked"], 1)
            self.assertEqual(summary["attendees"], 0)
            self.assertEqual(data["attendees"], [])
    def test_filters_intersect_and_include_unchecked(self):
        rows = [
            {"company_name": "Alpha", "domain": "alpha.test", "owner_name": None, "event_name": "A", "stage": "drafted", "in_aiark": None},
            {"company_name": "Beta", "domain": "beta.test", "owner_name": "Alex", "event_name": "A", "stage": "drafted", "in_aiark": 0},
            {"company_name": "Gamma", "domain": "gamma.test", "owner_name": "Alex", "event_name": "B", "stage": "drafted", "in_aiark": 0},
        ]
        self.assertEqual([r["company_name"] for r in filter_leads(rows, events={"A"}, stage="drafted", search="beta", aiark="Ghost")], ["Beta"])
        self.assertEqual([r["company_name"] for r in filter_leads(rows, aiark="Unchecked")], ["Alpha"])

    def test_queue_requires_approval_and_exact_current_draft(self):
        row = {"id": 7, "event_name": "A", "company_name": "Acme", "domain": "acme.test", "stage": "drafted", "needle_ref": None, "needle_status": "pending",
               "message": "Hi there", "in_aiark": 0, "owner_name": "Alex", "linkedin_url": "https://www.linkedin.com/in/alex"}
        reviewed = review_identity(row)
        self.assertFalse(queue_eligible(row, approved=False, reviewed_message="Hi there", reviewed_identity=reviewed))
        self.assertFalse(queue_eligible(row, approved=True, reviewed_message="Changed note", reviewed_identity=reviewed))
        self.assertTrue(queue_eligible(row, approved=True, reviewed_message="Hi there", reviewed_identity=reviewed))
        self.assertFalse(queue_eligible({**row, "in_aiark": None}, approved=True, reviewed_message="Hi there", reviewed_identity=reviewed))
        self.assertFalse(queue_eligible({**row, "needle_ref": "draft:123"}, approved=True, reviewed_message="Hi there", reviewed_identity=reviewed))
        self.assertFalse(queue_eligible({**row, "event_name": "SEED"}, approved=True, reviewed_message="Hi there", reviewed_identity=reviewed))
        self.assertFalse(queue_eligible({**row, "stage": "sent"}, approved=True, reviewed_message="Hi there", reviewed_identity=reviewed))
        self.assertFalse(queue_eligible({**row, "needle_status": "draft_reconcile"}, approved=True, reviewed_message="Hi there", reviewed_identity=reviewed))
        self.assertFalse(queue_eligible({**row, "linkedin_url": "https://www.linkedin.com/in/alex?redirect=evil"},
                                        approved=True, reviewed_message="Hi there",
                                        reviewed_identity=review_identity({**row, "linkedin_url": "https://www.linkedin.com/in/alex?redirect=evil"})))

    def test_recipient_change_invalidates_exact_review(self):
        row = {"id": 7, "event_name": "A", "company_name": "Acme", "domain": "acme.test",
               "stage": "drafted", "needle_ref": None, "needle_status": "pending",
               "message": "Hi Alex", "in_aiark": 0, "owner_name": "Alex",
               "linkedin_url": "https://www.linkedin.com/in/alex"}
        reviewed = review_identity(row)
        self.assertTrue(queue_eligible(row, approved=True, reviewed_message="Hi Alex", reviewed_identity=reviewed))
        for changed in ({"linkedin_url": "https://www.linkedin.com/in/other"},
                        {"owner_name": "Morgan"}, {"company_name": "Other Co"},
                        {"domain": "other.test"}, {"event_name": "B"}):
            with self.subTest(changed=changed):
                self.assertFalse(queue_eligible({**row, **changed}, approved=True,
                                                 reviewed_message="Hi Alex", reviewed_identity=reviewed))

    def test_export_neutralizes_spreadsheet_formulas(self):
        text = csv_export([{"company_name": " =IMPORTDATA(1)", "stage": "drafted", "domain": "-1"}])
        self.assertIn("' =IMPORTDATA(1)", text)
        self.assertIn("'-1", text)


if __name__ == "__main__":
    unittest.main()
