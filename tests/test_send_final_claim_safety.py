"""Offline regression for the final Needle draft compare-and-swap."""

import pytest

from ghostleads import db
from ghostleads.backend import send


@pytest.mark.parametrize("changed_column,new_value", [
    ("stage", "verified"),
    ("stage", "sent"),
    ("in_aiark", 1),
    ("in_aiark", None),
])
def test_provider_draft_cannot_be_queued_after_eligibility_changes(
    tmp_path, monkeypatch, changed_column, new_value
):
    path = tmp_path / "leads.db"
    monkeypatch.setenv("GL_DB", str(path))
    with db.connect(path) as conn:
        lead_id = conn.execute(
            "INSERT INTO leads (event_name,company_name,domain,owner_name,linkedin_url,message,stage,in_aiark) "
            "VALUES (?,?,?,?,?,?,?,?) RETURNING id",
            ("Real event", "Acme", "acme.example", "Alex Morgan",
             "https://www.linkedin.com/in/alex-morgan", "Exact approved note", "drafted", 0),
        ).fetchone()[0]
        conn.commit()
        snapshot = tuple(conn.execute(
            "SELECT id,event_name,company_name,domain,owner_name,linkedin_url,message "
            "FROM leads WHERE id=?", (lead_id,),
        ).fetchone())

        monkeypatch.setattr(send.needle, "linkedin_account", lambda: "account-id")

        def upsert(tool, **kwargs):
            assert tool == "needleUpsertLead"
            return {"lead": {"id": "lead-id"}}

        monkeypatch.setattr(send.needle, "call", upsert)
        attempts = []

        def create(**kwargs):
            attempts.append(kwargs)
            assert kwargs == {"connectedAccountId": "account-id", "leadId": "lead-id",
                              "action": "linkedin_invitation", "text": snapshot[-1]}
            assert conn.execute("SELECT needle_status FROM leads WHERE id=?", (lead_id,)).fetchone()[0] == "draft_creating"
            conn.execute(f"UPDATE leads SET {changed_column}=? WHERE id=?", (new_value, lead_id))
            conn.commit()  # A separate writer changes eligibility after the durable claim.
            return {"draft": {"id": "remote-draft-id"}}

        monkeypatch.setattr(send, "_create_draft_once", create)
        with pytest.raises(RuntimeError, match="manual reconciliation; do not retry"):
            send.create_reviewed_draft(lead_id, snapshot)

        row = conn.execute(
            "SELECT stage,in_aiark,needle_status,needle_ref FROM leads WHERE id=?", (lead_id,),
        ).fetchone()
        assert row[changed_column] == new_value
        assert row["needle_status"] == "draft_reconcile"
        assert row["needle_ref"] is None
        with pytest.raises(ValueError, match="changed|ineligible|already has a Needle draft claim"):
            send.create_reviewed_draft(lead_id, snapshot)
        assert len(attempts) == 1
