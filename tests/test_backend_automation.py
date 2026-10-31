"""Local, provider-free tests for the dashboard-facing backend API."""
from contextlib import nullcontext
import json

import httpx
import pytest

from ghostleads import db
from ghostleads.backend import aiark, automation, replies
from ghostleads.backend import send
from ghostleads.backend import draft, enrich, verify


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "leads.db"
    monkeypatch.setenv("GL_DB", str(path))
    conn = db.connect(path)
    yield conn
    conn.close()


def lead(conn, name="Real event", stage="scraped", **fields):
    data = {"event_name": name, "company_name": "Acme", "domain": f"{name.replace(' ', '').lower()}.example", "stage": stage, **fields}
    cols = list(data)
    return conn.execute(
        f"INSERT INTO leads ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)}) RETURNING id",
        list(data.values()),
    ).fetchone()[0]


def test_status_counts_real_rows_and_does_not_call_providers(store, monkeypatch):
    lead(store, "SEED", stage="sent", in_aiark=0, needle_status="sent")
    lead(store, "Alpha", stage="deduped", in_aiark=None)
    lead(store, "Beta", stage="drafted", in_aiark=0, needle_ref="draft:abc")
    lead(store, "Gamma", stage="sent", in_aiark=1, needle_status="sent")
    store.commit()
    monkeypatch.setattr("ghostleads.backend.needle.call", lambda *a, **k: pytest.fail("network call"))
    snapshot = automation.status(store)
    assert snapshot["total"] == 3
    assert snapshot["stages"] == {"scraped": 0, "deduped": 1, "enriched": 0, "verified": 0, "drafted": 1, "sent": 1, "replied": 0, "booked": 0}
    assert snapshot["aiark"] == {"ghost": 1, "in_database": 1, "unchecked": 1}
    assert snapshot["needle"]["pending_drafts"] == 1
    assert snapshot["needle"]["sent"] == 1


def test_public_api_exports():
    from ghostleads.backend import health, run_stages, status, sync
    assert (health, run_stages, status, sync) == (
        automation.health, automation.run_stages, automation.status, automation.sync,
    )


def test_health_missing_database_does_not_create_it(tmp_path, monkeypatch):
    path = tmp_path / "missing.db"
    monkeypatch.setenv("GL_DB", str(path))
    monkeypatch.setenv("OPENAI_API_KEY", "very-secret-value")
    result = automation.health()
    assert result["database"] == "missing"
    assert not path.exists()
    assert result["keys"]["OPENAI_API_KEY"] is True
    assert "very-secret-value" not in repr(result)


def test_run_stages_uses_real_database_transitions_and_never_sends(store, monkeypatch):
    row_id = lead(store)
    store.commit()
    calls = []

    def dedupe(argv):
        calls.append(("dedupe", argv))
        db.update(store, row_id, stage="deduped", in_aiark=0, aiark_checked_at="2026-10-31")

    def enrich(argv):
        calls.append(("enrich", argv))
        db.update(store, row_id, stage="enriched", enrichment_source="impressum")

    monkeypatch.setattr("ghostleads.backend.aiark.main", dedupe)
    monkeypatch.setattr("ghostleads.backend.enrich.main", enrich)
    monkeypatch.setattr("ghostleads.backend.send.main", lambda argv: pytest.fail("send must not run"))
    result = automation.run_stages(("dedupe", "enrich"), limit=1, phones=0)
    assert calls == [("dedupe", ["--limit", "1"]), ("enrich", ["--limit", "1", "--phones", "0"])]
    assert result["completed"] == ["dedupe", "enrich"]
    assert result["before"]["stages"]["scraped"] == 1
    assert result["after"]["stages"]["enriched"] == 1
    assert result["after"]["aiark"]["ghost"] == 1


def test_run_stages_executes_real_verify_step_without_network(store, monkeypatch):
    row_id = lead(store, stage="enriched", in_aiark=0)
    store.commit()
    monkeypatch.setattr("ghostleads.backend.enrich.blitz", lambda: nullcontext(object()))
    monkeypatch.setattr("ghostleads.backend.verify.has_mx", lambda *a: pytest.fail("no email needs no DNS"))
    result = automation.run_stages("verify", limit=1)
    assert result["completed"] == ["verify"]
    assert result["after"]["stages"]["verified"] == 1
    assert store.execute("SELECT email_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "unknown"


def test_run_stages_stops_when_dedupe_makes_no_progress(store, monkeypatch):
    lead(store)
    store.commit()
    monkeypatch.setattr("ghostleads.backend.aiark.main", lambda argv: None)  # blocked provider, no writes
    monkeypatch.setattr("ghostleads.backend.enrich.main", lambda argv: pytest.fail("must stop"))
    result = automation.run_stages(("dedupe", "enrich"))
    assert result["completed"] == []
    assert result["stopped"] == "dedupe: no progress; check provider output/status"
    assert result["after"]["stages"]["scraped"] == 1


def test_aiark_http_403_stops_real_stage_without_bypass(store, monkeypatch):
    row_id = lead(store)
    store.commit()

    class Blocked:
        status_code = 403
        text = "access denied"

    class Client:
        def get(self, path):
            assert path == "/v1/payments/credits"
            return Blocked()

    monkeypatch.setattr("ghostleads.backend.aiark.client", lambda: nullcontext(Client()))
    monkeypatch.setattr("ghostleads.backend.enrich.main", lambda argv: pytest.fail("cannot enrich unchecked lead"))
    result = automation.run_stages(("dedupe", "enrich"), limit=1)
    assert result["completed"] == []
    assert result["stopped"] == "dedupe: no progress; check provider output/status"
    assert result["after"]["aiark"]["unchecked"] == 1
    assert tuple(store.execute("SELECT stage, in_aiark FROM leads WHERE id=?", (row_id,)).fetchone()) == ("scraped", None)


def test_aiark_skip_if_blocked_never_advances_unchecked_rows(store, monkeypatch):
    row_id = lead(store)
    store.commit()

    class Client:
        def get(self, path):
            return type("Blocked", (), {"status_code": 403, "text": "denied"})()

    monkeypatch.setattr(aiark, "client", lambda: nullcontext(Client()))
    aiark.main(["--skip-if-blocked"])
    assert tuple(store.execute("SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (row_id,)).fetchone()) == ("scraped", None, None)


def test_aiark_batch_404_fails_without_marking_ghost(store, monkeypatch):
    row_id = lead(store)
    store.commit()

    def handler(request):
        if request.url.path == "/v1/payments/credits":
            return httpx.Response(200, json={"total": 100})
        assert request.url.path == "/v1/companies"
        return httpx.Response(404, json={"error": "endpoint missing"})

    monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
        base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
    with pytest.raises(httpx.HTTPStatusError):
        aiark.main([])
    assert tuple(store.execute("SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (row_id,)).fetchone()) == ("scraped", None, None)


def test_aiark_malformed_success_response_does_not_mark_ghost(store, monkeypatch):
    row_id = lead(store)
    store.commit()

    def handler(request):
        if request.url.path == "/v1/payments/credits":
            return httpx.Response(200, json={"total": 100})
        return httpx.Response(200, json={"error": "unexpected provider schema"})

    monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
        base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
    with pytest.raises(ValueError, match="AI Ark response missing company content"):
        aiark.main([])
    assert tuple(store.execute("SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (row_id,)).fetchone()) == ("scraped", None, None)


def test_aiark_short_first_page_still_checks_later_page_domain(store, monkeypatch):
    later = lead(store, "Later page")
    absent = lead(store, "Absent page")
    store.commit()
    pages = []

    def handler(request):
        if request.url.path == "/v1/payments/credits":
            return httpx.Response(200, json={"total": 100})
        body = json.loads(request.content)
        pages.append(body["page"])
        if body["page"] == 0:
            return httpx.Response(200, json={"content": [{"link": {"domain": "unrelated.example"}}],
                                             "totalPages": 2})
        if body["page"] == 1:
            return httpx.Response(200, json={"content": [{"link": {"domain": "laterpage.example"}}],
                                              "totalPages": 2})
        pytest.fail("unexpected page request")

    monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
        base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(aiark.time, "sleep", lambda seconds: None)
    aiark.main([])
    assert pages == [0, 1]
    assert tuple(store.execute("SELECT stage, in_aiark FROM leads WHERE id=?", (later,)).fetchone()) == ("deduped", 1)
    assert tuple(store.execute("SELECT stage, in_aiark FROM leads WHERE id=?", (absent,)).fetchone()) == ("deduped", 0)


def test_aiark_inconsistent_page_count_never_marks_leads_absent(store, monkeypatch):
    row_id = lead(store)
    store.commit()

    def handler(request):
        if request.url.path == "/v1/payments/credits":
            return httpx.Response(200, json={"total": 100})
        page = json.loads(request.content)["page"]
        return httpx.Response(200, json={"content": [], "totalPages": 2 if page == 0 else 1})

    monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
        base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(aiark.time, "sleep", lambda seconds: None)
    with pytest.raises(ValueError, match="totalPages"):
        aiark.main([])
    assert tuple(store.execute("SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (row_id,)).fetchone()) == ("scraped", None, None)


def test_aiark_empty_final_page_is_incomplete_not_a_ghost(store, monkeypatch):
    row_id = lead(store)
    store.commit()

    def handler(request):
        if request.url.path == "/v1/payments/credits":
            return httpx.Response(200, json={"total": 100})
        return httpx.Response(200, json={"content": [], "totalPages": 2})

    monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
        base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(aiark.time, "sleep", lambda seconds: None)
    with pytest.raises(ValueError, match="empty final page"):
        aiark.main([])
    assert tuple(store.execute("SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (row_id,)).fetchone()) == ("scraped", None, None)


def test_aiark_later_page_http_failure_keeps_whole_batch_unchecked(store, monkeypatch):
    first = lead(store, "First page")
    later = lead(store, "Later page")
    store.commit()

    def handler(request):
        if request.url.path == "/v1/payments/credits":
            return httpx.Response(200, json={"total": 100})
        if json.loads(request.content)["page"] == 0:
            return httpx.Response(200, json={"content": [{"link": {"domain": "firstpage.example"}}],
                                            "totalPages": 2})
        return httpx.Response(502, json={"error": "unavailable"})

    monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
        base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(aiark.time, "sleep", lambda seconds: None)
    with pytest.raises(httpx.HTTPStatusError):
        aiark.main([])
    for row_id in (first, later):
        assert tuple(store.execute("SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (row_id,)).fetchone()) == (
            "scraped", None, None)


def test_aiark_missing_pagination_metadata_is_not_an_absence(store, monkeypatch):
    row_id = lead(store)
    store.commit()

    def handler(request):
        if request.url.path == "/v1/payments/credits":
            return httpx.Response(200, json={"total": 100})
        return httpx.Response(200, json={"content": []})

    monkeypatch.setattr(aiark, "client", lambda: httpx.Client(
        base_url="https://example.invalid", transport=httpx.MockTransport(handler)))
    with pytest.raises(ValueError, match="totalPages"):
        aiark.main([])
    assert tuple(store.execute("SELECT stage, in_aiark, aiark_checked_at FROM leads WHERE id=?", (row_id,)).fetchone()) == ("scraped", None, None)


def test_unconnected_provider_stops_and_redacts_error(store, monkeypatch):
    row_id = lead(store, stage="deduped", in_aiark=0)
    store.commit()

    def missing_provider(argv):
        raise SystemExit("private provider detail must not be returned")

    monkeypatch.setattr("ghostleads.backend.enrich.main", missing_provider)
    monkeypatch.setattr("ghostleads.backend.verify.main", lambda argv: pytest.fail("must stop"))
    result = automation.run_stages(("enrich", "verify"))
    assert result["completed"] == []
    assert result["stopped"] == "enrich: failed (SystemExit); no later stages run"
    assert "private" not in repr(result)
    assert result["after"]["stages"]["deduped"] == 1
    assert store.execute("SELECT in_aiark FROM leads WHERE id=?", (row_id,)).fetchone()[0] == 0


def test_run_stages_rejects_outreach_and_invalid_options_before_side_effects(store):
    lead(store)
    store.commit()
    for stages, opts in [("send", {}), (("verify", "send"), {}), ("draft", {"limit": 0}), ("draft", {"phones": -1}), (("draft", "enrich"), {})]:
        with pytest.raises(ValueError):
            automation.run_stages(stages, **opts)
    assert automation.status(store)["stages"]["scraped"] == 1


def test_run_stages_blocks_enrichment_of_unchecked_rows(store, monkeypatch):
    lead(store, stage="deduped", in_aiark=None)
    store.commit()
    monkeypatch.setattr("ghostleads.backend.enrich.main", lambda argv: pytest.fail("unchecked lead"))
    result = automation.run_stages("enrich")
    assert result["stopped"] == "enrich: AI Ark check pending for deduped rows"
    assert result["completed"] == []


@pytest.mark.parametrize("name, stage", [("verify", "enriched"), ("draft", "verified")])
def test_downstream_stage_stops_on_unchecked_rows(store, monkeypatch, name, stage):
    lead(store, stage=stage, in_aiark=None, owner_name="Alex", linkedin_url="https://www.linkedin.com/in/alex/")
    store.commit()
    monkeypatch.setattr(f"ghostleads.backend.{name}.main", lambda argv: pytest.fail("unchecked lead"))
    result = automation.run_stages(name)
    assert result["stopped"] == f"{name}: AI Ark check pending for {stage} rows"


def test_direct_cli_stages_cannot_bypass_aiark(store, monkeypatch):
    for stage in ("deduped", "enriched", "verified", "drafted"):
        lead(store, name=f"Event {stage}", stage=stage, in_aiark=None, owner_name="Alex", message="Unchecked message",
             linkedin_url="https://www.linkedin.com/in/alex/")
    store.commit()
    monkeypatch.setattr("ghostleads.backend.enrich.blitz", lambda: pytest.fail("no unchecked enrichment"))
    monkeypatch.setattr("ghostleads.backend.draft.OpenAI", lambda *a, **k: pytest.fail("no unchecked drafting"))
    monkeypatch.setattr("ghostleads.backend.needle.linkedin_account", lambda: pytest.fail("no unchecked queueing"))
    enrich.main(["--phones", "0"])
    verify.main([])
    draft.main([])
    with pytest.raises(SystemExit, match="CLI draft creation disabled"):
        send.main(["--draft"])
    assert store.execute("SELECT COUNT(*) FROM leads WHERE in_aiark IS NULL").fetchone()[0] == 4


def test_sync_drafts_reads_actual_needle_status_and_not_direct_send(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, needle_ref="draft:abc", needle_status="pending")
    store.commit()
    calls = []

    def get_draft(tool, **kwargs):
        calls.append((tool, kwargs))
        return {"draft": {"status": "sent"}}

    monkeypatch.setattr("ghostleads.backend.needle.call", get_draft)
    result = automation.sync("drafts", conn=store)
    assert calls == [("needleGetDraft", {"draftId": "abc"})]
    assert result["before"]["needle"]["pending_drafts"] == 1
    assert result["after"]["needle"]["sent"] == 1
    assert store.execute("SELECT stage FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "sent"


def test_sync_rejects_unknown_kind_before_provider_call(store, monkeypatch):
    monkeypatch.setattr("ghostleads.backend.needle.call", lambda *a, **k: pytest.fail("network call"))
    with pytest.raises(ValueError):
        automation.sync("send", conn=store)


def test_legacy_direct_send_cannot_bypass_exact_text_approval(store, monkeypatch):
    row_id = lead(store, stage="drafted", message="Private draft", linkedin_url="https://linkedin.com/in/acme")
    store.commit()
    monkeypatch.setattr("ghostleads.backend.needle.call", lambda *a, **k: pytest.fail("direct send bypassed approval"))
    monkeypatch.setattr("ghostleads.backend.needle.linkedin_account", lambda: pytest.fail("should never request account"))
    with pytest.raises(SystemExit, match="Direct send disabled"):
        send.main(["--send", "--ids", str(row_id)])
    assert store.execute("SELECT stage, needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "drafted"


def reviewed(conn, row_id):
    row = conn.execute("SELECT id,event_name,company_name,domain,owner_name,linkedin_url,message "
                       "FROM leads WHERE id=?", (row_id,)).fetchone()
    return tuple(row)


def test_reviewed_draft_claims_before_provider_and_persists_exact_text(store, monkeypatch):
    note = "Guten Tag Alex,\nwir sahen Ihre Firma auf der Messe.\nSprechen wir?"
    row_id = lead(store, stage="drafted", in_aiark=0, message=note, owner_name="Alex Morgan",
                  linkedin_url="https://www.linkedin.com/in/alex-morgan")
    store.commit()
    snapshot = reviewed(store, row_id)
    monkeypatch.setattr("ghostleads.backend.needle.linkedin_account", lambda: "account-id")
    seen = []

    def upsert(tool, **kwargs):
        assert tool == "needleUpsertLead"
        assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "draft_creating"
        seen.append(tool)
        return {"lead": {"id": "lead-id"}}

    def create(**kwargs):
        assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "draft_creating"
        seen.append("needleCreateDraft")
        assert kwargs == {"connectedAccountId": "account-id", "leadId": "lead-id",
                          "action": "linkedin_invitation", "text": note}
        return {"draft": {"id": "draft-id"}}

    monkeypatch.setattr("ghostleads.backend.needle.call", upsert)
    monkeypatch.setattr(send, "_create_draft_once", create, raising=False)
    assert send.create_reviewed_draft(row_id, snapshot) == "draft:draft-id"
    assert seen == ["needleUpsertLead", "needleCreateDraft"]
    assert tuple(store.execute("SELECT stage, needle_status, needle_ref FROM leads WHERE id=?", (row_id,)).fetchone()) == (
        "drafted", "pending", "draft:draft-id")


@pytest.mark.parametrize("column,replacement", [
    ("event_name", "New event"), ("company_name", "New company"),
    ("domain", "new.example"), ("owner_name", "New person"),
    ("linkedin_url", "https://www.linkedin.com/in/new-person"), ("message", "Changed note"),
])
def test_reviewed_draft_rejects_changed_recipient_or_message_before_provider(store, monkeypatch, column, replacement):
    row_id = lead(store, stage="drafted", in_aiark=0, owner_name="Alex",
                  linkedin_url="https://www.linkedin.com/in/alex", message="Original note")
    store.commit()
    snapshot = reviewed(store, row_id)
    store.execute(f"UPDATE leads SET {column}=? WHERE id=?", (replacement, row_id))
    store.commit()
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: pytest.fail("no account lookup"))
    with pytest.raises(ValueError, match="changed"):
        send.create_reviewed_draft(row_id, snapshot)
    assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "pending"


def test_reviewed_draft_duplicate_race_is_rejected_during_first_provider_call(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, owner_name="Alex",
                  linkedin_url="https://www.linkedin.com/in/alex", message="One note")
    store.commit()
    snapshot = reviewed(store, row_id)
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: "account-id")

    def upsert(tool, **kwargs):
        with pytest.raises(ValueError, match="already has a Needle draft claim"):
            send.create_reviewed_draft(row_id, snapshot)
        assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "draft_creating"
        return {"lead": {"id": "lead-id"}}

    monkeypatch.setattr(send.needle, "call", upsert)
    monkeypatch.setattr(send, "_create_draft_once", lambda **kwargs: {"draft": {"id": "only-draft"}})
    assert send.create_reviewed_draft(row_id, snapshot) == "draft:only-draft"
    with pytest.raises(ValueError, match="already has a Needle draft claim"):
        send.create_reviewed_draft(row_id, snapshot)


def test_reviewed_draft_uses_claimed_snapshot_if_row_changes_after_claim(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, owner_name="Alex",
                  linkedin_url="https://www.linkedin.com/in/alex", message="Reviewed note")
    store.commit()
    snapshot = reviewed(store, row_id)

    def account():
        assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "draft_creating"
        store.execute("UPDATE leads SET message='Different note', linkedin_url='https://www.linkedin.com/in/other' WHERE id=?", (row_id,))
        store.commit()
        return "account-id"

    monkeypatch.setattr(send.needle, "linkedin_account", account)
    monkeypatch.setattr(send.needle, "call", lambda tool, **kwargs: (
        {"lead": {"id": "lead-id"}} if kwargs["identities"] == {"linkedin": "alex"}
        else pytest.fail("upserted a recipient not approved at claim")))

    def create(**kwargs):
        assert kwargs["text"] == "Reviewed note"
        return {"draft": {"id": "remote-id"}}

    monkeypatch.setattr(send, "_create_draft_once", create)
    with pytest.raises(RuntimeError, match="manual reconciliation"):
        send.create_reviewed_draft(row_id, snapshot)
    assert tuple(store.execute("SELECT needle_status, needle_ref FROM leads WHERE id=?", (row_id,)).fetchone()) == (
        "draft_reconcile", None)


def test_reviewed_draft_failed_claim_commit_never_calls_provider(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, owner_name="Alex",
                  linkedin_url="https://www.linkedin.com/in/alex", message="Reviewed note")
    store.commit()
    store.execute("CREATE TRIGGER reject_claim BEFORE UPDATE OF needle_status ON leads "
                  "WHEN NEW.needle_status='draft_creating' BEGIN SELECT RAISE(ABORT, 'claim failed'); END")
    store.commit()
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: pytest.fail("no provider after failed claim"))
    with pytest.raises(Exception, match="claim failed"):
        send.create_reviewed_draft(row_id, reviewed(store, row_id))
    assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "pending"


@pytest.mark.parametrize("name,checked,stage,status,ref,url", [
    ("SEED", 0, "drafted", "pending", None, "https://www.linkedin.com/in/alex"),
    ("Event", None, "drafted", "pending", None, "https://www.linkedin.com/in/alex"),
    ("Event", 1, "drafted", "pending", None, "https://www.linkedin.com/in/alex"),
    ("Event", 0, "verified", "pending", None, "https://www.linkedin.com/in/alex"),
    ("Event", 0, "drafted", "sent_conflict", None, "https://www.linkedin.com/in/alex"),
    ("Event", 0, "drafted", "draft_reconcile", None, "https://www.linkedin.com/in/alex"),
    ("Event", 0, "drafted", "pending", "draft:existing", "https://www.linkedin.com/in/alex"),
    ("Event", 0, "drafted", "pending", None, "https://www.linkedin.com.evil/in/alex"),
])
def test_reviewed_draft_rejects_ineligible_rows_without_provider(store, monkeypatch, name, checked, stage, status, ref, url):
    row_id = lead(store, name, stage=stage, in_aiark=checked, needle_status=status, needle_ref=ref,
                  owner_name="Alex", linkedin_url=url, message="One note")
    store.commit()
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: pytest.fail("no account lookup"))
    with pytest.raises(ValueError):
        send.create_reviewed_draft(row_id, reviewed(store, row_id))
    assert tuple(store.execute("SELECT needle_status, needle_ref FROM leads WHERE id=?", (row_id,)).fetchone()) == (status, ref)


def test_reviewed_draft_remote_success_but_local_reference_failure_is_nonretryable(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, owner_name="Alex",
                  linkedin_url="https://www.linkedin.com/in/alex", message="One note")
    store.commit()
    snapshot = reviewed(store, row_id)
    store.execute("CREATE TRIGGER reject_draft_ref BEFORE UPDATE OF needle_ref ON leads "
                  "WHEN NEW.needle_ref IS NOT NULL BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
    store.commit()
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: "account-id")
    monkeypatch.setattr(send.needle, "call", lambda *args, **kwargs: {"lead": {"id": "lead-id"}})
    created = []
    monkeypatch.setattr(send, "_create_draft_once", lambda **kwargs: (created.append(kwargs) or {"draft": {"id": "remote-id"}}))
    with pytest.raises(RuntimeError, match="manual reconciliation"):
        send.create_reviewed_draft(row_id, snapshot)
    assert len(created) == 1
    assert tuple(store.execute("SELECT needle_status, needle_ref FROM leads WHERE id=?", (row_id,)).fetchone()) == (
        "draft_reconcile", None)
    with pytest.raises(ValueError, match="already has a Needle draft claim"):
        send.create_reviewed_draft(row_id, snapshot)
    assert len(created) == 1


@pytest.mark.parametrize("response", [{}, {"draft": {}}, {"draft": {"id": None}}, {"draft": {"id": 42}}])
def test_reviewed_draft_malformed_provider_response_requires_manual_reconcile(store, monkeypatch, response):
    row_id = lead(store, stage="drafted", in_aiark=0, owner_name="Alex",
                  linkedin_url="https://www.linkedin.com/in/alex", message="One note")
    store.commit()
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: "account-id")
    monkeypatch.setattr(send.needle, "call", lambda *args, **kwargs: {"lead": {"id": "lead-id"}})
    monkeypatch.setattr(send, "_create_draft_once", lambda **kwargs: response)
    with pytest.raises(RuntimeError, match="manual reconciliation"):
        send.create_reviewed_draft(row_id, reviewed(store, row_id))
    assert tuple(store.execute("SELECT needle_status, needle_ref FROM leads WHERE id=?", (row_id,)).fetchone()) == (
        "draft_reconcile", None)


def test_reviewed_draft_timeout_is_nonretryable(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, owner_name="Alex",
                  linkedin_url="https://www.linkedin.com/in/alex", message="One note")
    store.commit()
    snapshot = reviewed(store, row_id)
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: "account-id")
    monkeypatch.setattr(send.needle, "call", lambda *args, **kwargs: {"lead": {"id": "lead-id"}})
    attempts = []

    def timed_out(**kwargs):
        attempts.append(kwargs)
        raise httpx.ReadTimeout("unknown remote outcome")

    monkeypatch.setattr(send, "_create_draft_once", timed_out)
    with pytest.raises(RuntimeError, match="manual reconciliation"):
        send.create_reviewed_draft(row_id, snapshot)
    assert len(attempts) == 1
    assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "draft_reconcile"
    with pytest.raises(ValueError, match="already has a Needle draft claim"):
        send.create_reviewed_draft(row_id, snapshot)
    assert len(attempts) == 1


def test_cli_draft_rejects_bulk_or_single_before_connecting(store, monkeypatch):
    monkeypatch.setattr(send, "connect", lambda: pytest.fail("no database connection for CLI bypass"))
    monkeypatch.setattr(send.needle, "linkedin_account", lambda: pytest.fail("no provider call"))
    for args in (["--draft"], ["--draft", "--ids", "1", "--limit", "1"]):
        with pytest.raises(SystemExit, match="CLI draft creation disabled"):
            send.main(args)


def test_create_draft_one_shot_http_does_not_retry_429(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(429, json={"error": "rate limited"})

    monkeypatch.setattr(send, "key", lambda name: "mock-secret")
    real_client = httpx.Client
    monkeypatch.setattr(send.httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(httpx.HTTPStatusError):
        send._create_draft_once(connectedAccountId="acc", leadId="lead", action="linkedin_invitation", text="One note")
    assert len(requests) == 1
    assert requests[0].url == send.needle.URL


@pytest.mark.parametrize("sse", [False, True])
def test_create_draft_one_shot_http_parses_json_and_sse(monkeypatch, sse):
    requests = []

    def handler(request):
        requests.append(request)
        rpc = {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"text": '{"draft":{"id":"remote-id"}}'}]}}
        wire = json.dumps(rpc)
        return httpx.Response(200, text=f"event: message\ndata: {wire}\n\n" if sse else wire)

    monkeypatch.setattr(send, "key", lambda name: "mock-secret")
    real_client = httpx.Client
    monkeypatch.setattr(send.httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(handler), **kwargs))
    assert send._create_draft_once(connectedAccountId="acc", leadId="lead", action="linkedin_invitation",
                                   text="Exact\nmessage") == {"draft": {"id": "remote-id"}}
    assert len(requests) == 1
    body = json.loads(requests[0].content)
    assert body["params"]["name"] == "needleCreateDraft"
    assert body["params"]["arguments"]["text"] == "Exact\nmessage"


def test_sync_drafts_ignores_seed_even_if_it_has_a_draft(store, monkeypatch):
    lead(store, "SEED", stage="drafted", needle_ref="draft:seed")
    store.commit()
    monkeypatch.setattr("ghostleads.backend.needle.call", lambda *a, **k: pytest.fail("seed must not use provider calls"))
    result = automation.sync("drafts", conn=store)
    assert result["after"]["total"] == 0


def test_sync_draft_only_marks_sent_after_needle_reports_sent(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, needle_ref="draft:real")
    store.commit()
    responses = iter(({"draft": {"status": "pending"}}, {"draft": {"status": "sent"}}))

    def get_draft(tool, **kwargs):
        assert (tool, kwargs) == ("needleGetDraft", {"draftId": "real"})
        return next(responses)

    monkeypatch.setattr("ghostleads.backend.needle.call", get_draft)
    first = automation.sync("drafts", conn=store)
    assert first["after"]["stages"]["drafted"] == 1
    second = automation.sync("drafts", conn=store)
    assert second["after"]["stages"]["sent"] == 1
    assert store.execute("SELECT needle_status FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "sent"


def test_sync_sent_draft_with_unchecked_aiark_is_explicit_conflict(store, monkeypatch, capsys):
    row_id = lead(store, stage="drafted", in_aiark=None, needle_ref="draft:unchecked")
    store.commit()
    calls = []

    def get_draft(tool, **kwargs):
        calls.append((tool, kwargs))
        return {"draft": {"status": "sent"}}

    monkeypatch.setattr("ghostleads.backend.needle.call", get_draft)
    send.sync(store)
    assert tuple(store.execute("SELECT stage, needle_status, in_aiark, needle_ref FROM leads WHERE id=?", (row_id,)).fetchone()) == (
        "drafted", "sent_conflict", None, "draft:unchecked")
    assert "conflict" in capsys.readouterr().out.lower()
    assert automation.status(store)["needle"]["sent_conflict"] == 1
    send.sync(store)
    assert calls == [("needleGetDraft", {"draftId": "unchecked"})]


@pytest.mark.parametrize("name,stage,checked", [
    ("SEED", "sent", 0), ("Real event", "sent", None),
    ("Real event", "verified", 0), ("Real event", "drafted", 0),
    ("Real event", "replied", 0),
])
def test_paste_rejects_unsafe_lead_without_promoting_it(store, monkeypatch, name, stage, checked):
    row_id = lead(store, name, stage=stage, in_aiark=checked, needle_status="sent")
    store.commit()
    monkeypatch.setattr(replies, "classify", lambda text: pytest.fail("unsafe row cannot be classified"))
    with pytest.raises(ValueError):
        replies.main(["paste", str(row_id), "Inbound evidence"])
    r = store.execute("SELECT stage, needle_status, reply_text, reply_class FROM leads WHERE id=?", (row_id,)).fetchone()
    assert (r["stage"], r["needle_status"], r["reply_class"]) == (
        stage, "sent" if name == "SEED" or stage == "replied" else "sent_conflict", None)
    assert r["reply_text"] == (None if name == "SEED" or stage == "replied" else "Inbound evidence")


def test_paste_promotes_only_checked_sent_real_lead(store, monkeypatch):
    row_id = lead(store, stage="sent", in_aiark=0, needle_status="sent")
    store.commit()
    monkeypatch.setattr(replies, "classify", lambda text: "interested")
    replies.main(["paste", str(row_id), "Let's talk"])
    assert tuple(store.execute("SELECT stage, needle_status, reply_class, reply_text FROM leads WHERE id=?", (row_id,)).fetchone()) == (
        "replied", "replied", "interested", "Let's talk")


def test_paste_preserves_unproven_inbound_and_reports_reply_conflict(store, monkeypatch):
    row_id = lead(store, stage="drafted", in_aiark=0, needle_status="pending")
    store.commit()
    monkeypatch.setattr(replies, "classify", lambda text: pytest.fail("not ready to classify"))
    with pytest.raises(ValueError, match="manual review"):
        replies.record_reply(store, row_id, "Unexpected inbound")
    assert tuple(store.execute("SELECT stage, needle_status, reply_text FROM leads WHERE id=?", (row_id,)).fetchone()) == (
        "drafted", "reply_conflict", "Unexpected inbound")
    assert automation.status(store)["needle"]["reply_conflict"] == 1
    with pytest.raises(ValueError, match="already recorded"):
        replies.record_reply(store, row_id, "Different text")
    assert store.execute("SELECT reply_text FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "Unexpected inbound"


def test_sync_quarantines_unsafe_inbound_and_continues_to_eligible_lead(store, monkeypatch, capsys):
    unsafe = lead(store, "Unchecked inbound", stage="sent", in_aiark=None, needle_status="sent",
                  owner_name="Alex", linkedin_url="https://www.linkedin.com/in/unsafe")
    eligible = lead(store, "Checked inbound", stage="sent", in_aiark=0, needle_status="sent",
                    owner_name="Bea", linkedin_url="https://www.linkedin.com/in/eligible")
    store.commit()
    seen = []
    classified = []
    monkeypatch.setattr(send, "needle_lead", lambda row: str(row["id"]))

    def events(tool, **kwargs):
        assert tool == "needleListLeadEvents"
        seen.append(kwargs["leadId"])
        return {"events": [{"type": "message_received", "occurredAt": "2026-01-01T00:00:00Z",
                            "data": {"text": f"Inbound {kwargs['leadId']}"}}]}

    monkeypatch.setattr("ghostleads.backend.needle.call", events)
    monkeypatch.setattr(replies, "classify", lambda text: classified.append(text) or "question")
    replies.sync(store)
    assert seen == [str(unsafe), str(eligible)]
    assert classified == [f"Inbound {eligible}"]
    assert tuple(store.execute("SELECT stage, in_aiark, needle_status, reply_text, reply_class FROM leads WHERE id=?",
                               (unsafe,)).fetchone()) == ("sent", None, "sent_conflict", f"Inbound {unsafe}", None)
    assert tuple(store.execute("SELECT stage, needle_status, reply_text, reply_class FROM leads WHERE id=?",
                               (eligible,)).fetchone()) == ("replied", "replied", f"Inbound {eligible}", "question")
    assert "conflict" in capsys.readouterr().out.lower()
    replies.sync(store)
    assert seen == [str(unsafe), str(eligible)]  # saved evidence prevents a repeat fetch


def test_draft_redo_does_not_change_message_with_queued_needle_draft(store, monkeypatch):
    queued = lead(store, stage="drafted", in_aiark=0, needle_ref="draft:queued", needle_status="pending",
                  message="Approved exact message", owner_name="Alex", linkedin_url="https://linkedin.com/in/alex")
    editable = lead(store, "Other event", stage="drafted", in_aiark=0, message="Old note",
                    owner_name="Bea", linkedin_url="https://linkedin.com/in/bea")
    store.commit()
    monkeypatch.setattr(draft, "OpenAI", lambda **kwargs: object())
    seen = []

    def write_note(client, cfg, conn, r):
        seen.append(r["id"])
        return "Revised note"

    monkeypatch.setattr(draft, "write_note", write_note)
    draft.main(["--redo"])
    assert seen == [editable]
    assert tuple(store.execute("SELECT message, needle_ref FROM leads WHERE id=?", (queued,)).fetchone()) == (
        "Approved exact message", "draft:queued")
    assert store.execute("SELECT message FROM leads WHERE id=?", (editable,)).fetchone()[0] == "Revised note"

def test_draft_redo_does_not_change_message_with_unresolved_needle_claim(store, monkeypatch):
    claims = [lead(store, f"Claim {status}", stage="drafted", in_aiark=0, needle_ref=None,
                   needle_status=status, message="Exact reviewed note", owner_name="Alex",
                   linkedin_url="https://linkedin.com/in/alex")
              for status in ("draft_creating", "draft_reconcile")]
    store.commit()
    monkeypatch.setattr(draft, "OpenAI", lambda **kwargs: object())
    monkeypatch.setattr(draft, "write_note", lambda *args: pytest.fail("Unresolved claims must not be redrafted"))
    draft.main(["--redo"])
    for row_id in claims:
        assert store.execute("SELECT message FROM leads WHERE id=?", (row_id,)).fetchone()[0] == "Exact reviewed note"


def test_phone_lookup_never_spends_credit_on_seed_even_if_first(store, monkeypatch):
    seed_id = lead(store, "SEED", stage="enriched", in_aiark=0, linkedin_url="https://linkedin.com/in/seed")
    real_id = lead(store, stage="enriched", in_aiark=0, linkedin_url="https://linkedin.com/in/real")
    store.commit()
    monkeypatch.setattr(enrich.aiark, "client", lambda: nullcontext(object()))
    monkeypatch.setattr(enrich.aiark, "credits", lambda c: {"total": 100})
    monkeypatch.setattr(enrich.time, "sleep", lambda seconds: None)
    requested = []

    def phone(c, url):
        requested.append(url)
        return "+123"

    monkeypatch.setattr(enrich, "phone", phone)
    assert enrich.add_phones(store, 1) == 1
    assert requested == ["https://linkedin.com/in/real"]
    assert store.execute("SELECT phone FROM leads WHERE id=?", (seed_id,)).fetchone()[0] is None
    assert store.execute("SELECT phone FROM leads WHERE id=?", (real_id,)).fetchone()[0] == "+123"


def test_sync_replies_ignores_seed_even_if_marked_sent(store, monkeypatch):
    lead(store, "SEED", stage="sent", needle_status="sent", linkedin_url="https://linkedin.com/in/seed")
    store.commit()
    monkeypatch.setattr("ghostleads.backend.send.needle_lead", lambda r: pytest.fail("seed must not be upserted"))
    automation.sync("replies", conn=store)
