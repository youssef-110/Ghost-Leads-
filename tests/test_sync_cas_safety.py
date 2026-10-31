"""Offline races between provider lookups and local persistence."""

import pytest

from ghostleads import db
from ghostleads.backend import aiark, send


def test_sent_sync_quarantines_eligibility_changed_during_lookup(tmp_path, monkeypatch):
    path = tmp_path / "sent-race.db"
    with db.connect(path) as primary, db.connect(path) as competitor:
        lead_id = primary.execute(
            "INSERT INTO leads(event_name, company_name, domain, stage, in_aiark, "
            "needle_ref, needle_status) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            ("Real event", "Acme", "acme.example", "drafted", 0, "draft:remote-id", "pending"),
        ).fetchone()[0]
        primary.commit()

        def lookup(tool, **kwargs):
            assert (tool, kwargs) == ("needleGetDraft", {"draftId": "remote-id"})
            db.update(competitor, lead_id, in_aiark=1)
            return {"draft": {"status": "sent"}}

        monkeypatch.setattr(send.needle, "call", lookup)
        send.sync(primary)
        assert tuple(primary.execute(
            "SELECT stage, in_aiark, needle_status, needle_ref FROM leads WHERE id=?", (lead_id,)
        ).fetchone()) == ("drafted", 1, "sent_conflict", "draft:remote-id")


def test_aiark_does_not_apply_old_domain_result_to_changed_domain(tmp_path, monkeypatch):
    path = tmp_path / "domain-race.db"
    monkeypatch.setenv("GL_DB", str(path))
    with db.connect(path) as primary, db.connect(path) as competitor:
        lead_id = primary.execute(
            "INSERT INTO leads(event_name, company_name, domain) VALUES (?, ?, ?) RETURNING id",
            ("Real event", "Acme", "old.example"),
        ).fetchone()[0]
        primary.commit()

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def get(self, path):
                class Response:
                    status_code = 200
                    is_success = True

                    def json(self):
                        return {"total": 100}

                return Response()

        monkeypatch.setattr(aiark, "client", FakeClient)

        def lookup(client, domains):
            assert domains == ["old.example"]
            db.update(competitor, lead_id, domain="new.example")
            return set()  # A miss for the OLD domain says nothing about the new one.

        monkeypatch.setattr(aiark, "found_domains", lookup)
        with pytest.raises(RuntimeError, match="changed during AI Ark lookup"):
            aiark.main([])
        assert tuple(primary.execute(
            "SELECT domain, stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (lead_id,)
        ).fetchone()) == ("new.example", "scraped", None, None)
