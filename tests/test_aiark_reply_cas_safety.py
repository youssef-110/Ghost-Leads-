"""Offline regressions for fail-closed AI Ark results and inbound reply races."""
import json

import httpx
import pytest

from ghostleads import db
from ghostleads.backend import aiark, replies, send


@pytest.fixture
def stores(tmp_path):
    path = tmp_path / "reply-races.db"
    primary = db.connect(path)
    lead_id = primary.execute(
        "INSERT INTO leads(event_name, company_name, domain, stage, in_aiark, needle_status) "
        "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        ("Real event", "Acme", "acme.example", "sent", 0, "sent"),
    ).fetchone()[0]
    primary.commit()
    competitor = db.connect(path)
    try:
        yield primary, competitor, lead_id
    finally:
        competitor.close()
        primary.close()


def test_record_reply_does_not_overwrite_reply_saved_during_classification(stores, monkeypatch):
    primary, competitor, lead_id = stores

    def race(text):
        db.update(competitor, lead_id, reply_text="Earlier inbound", reply_class="question",
                  needle_status="replied", stage="replied")
        return "interested"

    monkeypatch.setattr(replies, "classify", race)
    with pytest.raises(replies.ReplyConflict, match="manual review"):
        replies.record_reply(primary, lead_id, "Later inbound")
    assert tuple(primary.execute(
        "SELECT reply_text, reply_class, needle_status, stage FROM leads WHERE id=?", (lead_id,)
    ).fetchone()) == ("Earlier inbound", "question", "replied", "replied")


@pytest.mark.parametrize("change", [
    {"stage": "drafted"},
    {"in_aiark": 1},
    {"needle_status": "sent_conflict"},
    {"event_name": "SEED"},
])
def test_record_reply_does_not_promote_if_eligibility_changes_during_classification(stores, monkeypatch, change):
    primary, competitor, lead_id = stores

    def race(text):
        db.update(competitor, lead_id, **change)
        return "interested"

    monkeypatch.setattr(replies, "classify", race)
    with pytest.raises(replies.ReplyConflict, match="manual review"):
        replies.record_reply(primary, lead_id, "Let's talk")
    row = primary.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    assert all(row[field] == value for field, value in change.items())
    assert (row["reply_text"], row["reply_class"]) == (None, None)


def test_unsafe_inbound_does_not_replace_reply_racing_after_read(stores, monkeypatch):
    primary, competitor, lead_id = stores
    db.update(primary, lead_id, stage="drafted", needle_status="pending")
    monkeypatch.setattr(replies, "classify", lambda text: pytest.fail("unsafe row cannot be classified"))

    class RacingConnection:
        def execute(self, sql, args=()):
            cursor = primary.execute(sql, args)
            if not sql.startswith("SELECT event_name, stage"):
                return cursor

            class ReadThenRace:
                def fetchone(self):
                    row = cursor.fetchone()
                    db.update(competitor, lead_id, reply_text="Earlier inbound",
                              needle_status="reply_conflict")
                    return row

            return ReadThenRace()

        def commit(self):
            primary.commit()

    with pytest.raises(replies.ReplyConflict, match="manual review"):
        replies.record_reply(RacingConnection(), lead_id, "Later inbound")
    assert tuple(primary.execute(
        "SELECT stage, needle_status, reply_text, reply_class FROM leads WHERE id=?", (lead_id,)
    ).fetchone()) == ("drafted", "reply_conflict", "Earlier inbound", None)


def test_sync_continues_when_other_worker_records_reply_before_our_read(stores, monkeypatch, capsys):
    primary, competitor, first = stores
    second = primary.execute(
        "INSERT INTO leads(event_name, company_name, domain, stage, in_aiark, needle_status, linkedin_url) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        ("Real event", "Beta", "beta.example", "sent", 0, "sent", "https://linkedin.example/in/beta"),
    ).fetchone()[0]
    primary.commit()
    db.update(primary, first, linkedin_url="https://linkedin.example/in/acme")
    monkeypatch.setattr(send, "needle_lead", lambda row: str(row["id"]))
    monkeypatch.setattr(replies, "classify", lambda text: "question")

    def events(tool, **kwargs):
        if kwargs["leadId"] == str(first):
            db.update(competitor, first, reply_text="Earlier inbound", reply_class="later",
                      needle_status="replied", stage="replied")
        return {"events": [{"type": "message_received", "occurredAt": "2026-01-01T00:00:00Z",
                            "data": {"text": "New inbound"}}]}

    monkeypatch.setattr(replies.needle, "call", events)
    replies.sync(primary)
    assert tuple(primary.execute("SELECT reply_text, reply_class FROM leads WHERE id=?", (first,)).fetchone()) == (
        "Earlier inbound", "later")
    assert tuple(primary.execute("SELECT reply_text, reply_class, stage FROM leads WHERE id=?", (second,)).fetchone()) == (
        "New inbound", "question", "replied")
    assert "'conflict': 1" in capsys.readouterr().out


def test_accepted_sync_does_not_overwrite_reply_saved_while_fetching_events(stores, monkeypatch, capsys):
    primary, competitor, lead_id = stores
    db.update(primary, lead_id, linkedin_url="https://linkedin.example/in/acme")
    monkeypatch.setattr(send, "needle_lead", lambda row: str(row["id"]))

    def events(tool, **kwargs):
        db.update(competitor, lead_id, reply_text="Inbound already saved", reply_class="question",
                  needle_status="replied", stage="replied")
        return {"events": [{"type": "invitation_accepted"}]}

    monkeypatch.setattr(replies.needle, "call", events)
    replies.sync(primary)
    assert tuple(primary.execute(
        "SELECT reply_text, reply_class, needle_status, stage FROM leads WHERE id=?", (lead_id,)
    ).fetchone()) == ("Inbound already saved", "question", "replied", "replied")
    assert "'accepted': 0" in capsys.readouterr().out


def test_aiark_empty_advertised_first_page_keeps_leads_unchecked(tmp_path, monkeypatch):
    path = tmp_path / "leads.db"
    monkeypatch.setenv("GL_DB", str(path))
    conn = db.connect(path)
    try:
        lead_id = conn.execute(
            "INSERT INTO leads(event_name, company_name, domain) VALUES (?, ?, ?) RETURNING id",
            ("Real event", "Acme", "acme.example"),
        ).fetchone()[0]
        conn.commit()
        pages = []

        def handler(request):
            if request.url.path == "/v1/payments/credits":
                return httpx.Response(200, json={"total": 100})
            pages.append(json.loads(request.content)["page"])
            return httpx.Response(200, json={"content": [], "totalPages": 1})

        monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
            base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
        monkeypatch.setattr(aiark.time, "sleep", lambda seconds: None)
        with pytest.raises(ValueError, match="empty.*page"):
            aiark.main([])
        assert pages == [0]
        assert tuple(conn.execute(
            "SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (lead_id,)
        ).fetchone()) == ("scraped", None, None)
    finally:
        conn.close()
