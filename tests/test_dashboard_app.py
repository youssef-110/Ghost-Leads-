"""Offline Streamlit integration tests: every route renders, never invokes a provider."""
import importlib.util
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, skipUnless
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

@skipUnless(importlib.util.find_spec("streamlit"), "Streamlit not installed in this interpreter")
class DashboardAppTests(TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory(dir=Path.home() / "AppData" / "Local" / "hermes" / "cache" / "scratch")
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "snapshot.db"
        with closing(sqlite3.connect(self.path)) as conn:
            conn.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
            conn.executemany("INSERT INTO leads(event_name,company_name,domain,stage,in_aiark,needle_status,message,linkedin_url,owner_name) VALUES (?,?,?,?,?,?,?,?,?)", [
                ("SEED", "Sample", "seed.invalid", "sent", 0, "sent", "sample", None, None),
                ("Web Summit 2026", "Ghost firm", "ghost.test", "drafted", 0, "pending", "A reviewed note", "https://www.linkedin.com/in/ghost", "Owner"),
                ("Web Summit 2026", "Unchecked firm", "unknown.test", "drafted", None, "pending", "An unchecked note", "https://www.linkedin.com/in/unknown", "Owner"),
                ("it-sa 2026", "Seen firm", "seen.test", "deduped", 1, "pending", None, None, None),
            ])
            conn.commit()

    def app(self):
        from streamlit.testing.v1 import AppTest
        with patch.dict(os.environ, {"GL_DB": str(self.path)}):
            instance = AppTest.from_file(str(ROOT / "app" / "dashboard.py"), default_timeout=30).run()
        self.assertFalse(instance.exception, [e.message for e in instance.exception])
        return instance

    def test_every_view_renders_without_provider_actions(self):
        app = self.app()
        with patch.dict(os.environ, {"GL_DB": str(self.path)}):
            for view in ("Pipeline", "Leads", "Draft review", "Runs", "Events", "System"):
                with self.subTest(view=view):
                    app.sidebar.radio[0].set_value(view).run()
                    self.assertFalse(app.exception, [e.message for e in app.exception])
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM leads WHERE needle_ref IS NOT NULL").fetchone()[0], 0)

    def test_unchecked_draft_is_flagged_and_needs_explicit_approval(self):
        app = self.app()
        with patch.dict(os.environ, {"GL_DB": str(self.path)}):
            app.sidebar.radio[0].set_value("Draft review").run()
            self.assertFalse(app.exception)
            app.selectbox[0].set_value("#3 · Unchecked firm · Web Summit 2026").run()
            self.assertFalse(app.exception)
            self.assertTrue(any("not counted as a ghost" in str(i.value) for i in app.info))
            self.assertTrue(next(b for b in app.button if b.label.startswith("Create ONE")).disabled)
            app.checkbox[0].set_value(True).run()
            self.assertFalse(next(b for b in app.button if b.label.startswith("Create ONE")).disabled)

    def test_reviewed_click_passes_exact_snapshot_to_backend_once(self):
        app = self.app()
        with patch.dict(os.environ, {"GL_DB": str(self.path)}):
            app.sidebar.radio[0].set_value("Draft review").run()
            app.selectbox[0].set_value("#2 · Ghost firm · Web Summit 2026").run()
            self.assertTrue(next(b for b in app.button if b.label.startswith("Create ONE")).disabled)
            app.checkbox[0].set_value(True).run()
            self.assertFalse(next(b for b in app.button if b.label.startswith("Create ONE")).disabled)

            def record_call(lead_id, snapshot):
                self.assertEqual(lead_id, 2)
                self.assertEqual(tuple(snapshot), (2, "Web Summit 2026", "Ghost firm", "ghost.test",
                                                   "Owner", "https://www.linkedin.com/in/ghost", "A reviewed note"))
                with closing(sqlite3.connect(self.path)) as conn:
                    conn.execute("UPDATE leads SET needle_ref=? WHERE id=?", ("draft:mock-id", lead_id))
                    conn.commit()
                return "draft:mock-id"

            with patch("ghostleads.backend.send.create_reviewed_draft", side_effect=record_call) as create:
                next(b for b in app.button if b.label.startswith("Create ONE")).click().run()
            create.assert_called_once()
            self.assertFalse(app.exception, [e.message for e in app.exception])
            self.assertTrue(any("Needle draft confirmed" in str(s.value) for s in app.success))

    def test_revised_draft_cannot_overwrite_inflight_provider_claim(self):
        app = self.app()
        with patch.dict(os.environ, {"GL_DB": str(self.path)}):
            app.sidebar.radio[0].set_value("Draft review").run()
            app.selectbox[0].set_value("#2 · Ghost firm · Web Summit 2026").run()
            app.text_area[0].set_value("Revised but not approved").run()
            with closing(sqlite3.connect(self.path)) as conn:
                conn.execute("UPDATE leads SET needle_status='draft_creating' WHERE id=2")
                conn.commit()
            next(b for b in app.button if b.label == "Save revised draft").click().run()
            self.assertFalse(app.exception, [e.message for e in app.exception])
            with closing(sqlite3.connect(self.path)) as conn:
                self.assertEqual(conn.execute("SELECT message, needle_status FROM leads WHERE id=2").fetchone(),
                                 ("A reviewed note", "draft_creating"))

    def test_run_action_uses_same_custom_database_as_display(self):
        app = self.app()
        with patch.dict(os.environ, {"GL_DB": str(self.path)}):
            app.sidebar.radio[0].set_value("Runs").run()
            assert not app.exception, [e.message for e in app.exception]
            self.assertTrue(any("AI Ark check · 1 potentially eligible" in e.label for e in app.expander))
            box = next(c for c in app.checkbox if "Run dedupe" in c.label)
            box.set_value(True).run()

            def check_database(stages, limit):
                from ghostleads.db import connect
                self.assertEqual(stages, ["dedupe"])
                self.assertEqual(os.environ["GL_DB"], str(self.path))
                with closing(connect()) as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0], 2)
                raise RuntimeError("test stops before provider")

            with patch("ghostleads.backend.automation.run_stages", side_effect=check_database) as run:
                next(b for b in app.button if b.label == "Run dedupe stage").click().run()
            run.assert_called_once()
            self.assertFalse(app.exception, [e.message for e in app.exception])

    def test_missing_db_does_not_create_file(self):
        missing = self.path.with_name("absent.db")
        from streamlit.testing.v1 import AppTest
        with patch.dict(os.environ, {"GL_DB": str(missing)}):
            app = AppTest.from_file(str(ROOT / "app" / "dashboard.py"), default_timeout=30).run()
        self.assertFalse(missing.exists())
        self.assertTrue(app.error)
