"""Ghost Leads · local-first operations cockpit. Launch with streamlit run app/dashboard.py.

Page loads are read-only. Provider stages and per-lead Needle draft creation require clicks.
This app never directly sends outreach or books meetings.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from contextlib import closing
from html import escape
from pathlib import Path
from urllib.parse import urlparse

import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT / "src"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
from app.dashboard_helpers import STAGES, csv_export, filter_leads, load_snapshot, queue_eligible, review_identity, summarize  # noqa: E402
from ghostleads.backend import config as backend_config  # noqa: E402 (loads .env before resolving GL_DB)

DB = Path(os.getenv("GL_DB") or backend_config.ROOT / "data" / "ghostleads.db").resolve()
LABEL = {"scraped": "Captured", "deduped": "AI Ark checked", "enriched": "Enriched", "verified": "Verified", "drafted": "Draft ready", "sent": "Sent", "replied": "Replied", "booked": "Booked"}
VIEWS = ("Overview", "Pipeline", "Leads", "Draft review", "Runs", "Events", "System")
st.set_page_config(page_title="Ghost Leads | Field intelligence", page_icon="◈", layout="wide", initial_sidebar_state="expanded")
st.markdown(f"<style>{(ROOT / 'app' / 'styles.css').read_text(encoding='utf-8')}</style>", unsafe_allow_html=True)


def clean(value, fallback="—"):
    return escape(str(value if value not in (None, "") else fallback), quote=True)


def heading(number, title, description):
    st.markdown(f'<div class="page-heading"><span class="eyebrow">FIELD INTELLIGENCE / {clean(number)}</span><h1>{clean(title)}</h1><p>{clean(description)}</p></div>', unsafe_allow_html=True)


def section(title, detail=""):
    st.markdown(f'<div class="section-heading"><h2>{clean(title)}</h2><span>{clean(detail, "")}</span></div>', unsafe_allow_html=True)


def metric(title, number, detail, accent=False):
    st.markdown(f'<div class="metric-card {"gold" if accent else ""}"><span>{clean(title)}</span><strong>{clean(number)}</strong><small>{clean(detail)}</small></div>', unsafe_allow_html=True)


def note(title, detail, accent=False):
    st.markdown(f'<div class="note-card {"warm" if accent else ""}"><strong>{clean(title)}</strong><p>{clean(detail)}</p></div>', unsafe_allow_html=True)


def safe_url(value):
    if not value: return None
    parsed = urlparse(value)
    return value if parsed.scheme == "https" and parsed.netloc and not parsed.username and not parsed.password else None


with st.sidebar:
    st.markdown('<div class="brand"><span class="brand-glyph">◈</span><div><strong>GHOST LEADS</strong><small>FIELD INTELLIGENCE</small></div></div>', unsafe_allow_html=True)
    st.markdown('<div class="side-label">WORKSPACE</div>', unsafe_allow_html=True)
    view = st.radio("Workspace", VIEWS, key="workspace_view", label_visibility="collapsed")
    st.markdown('<div class="side-foot"><span class="status-dot"></span> LOCAL OPERATIONS<br><small>No automatic sends on page load</small></div>', unsafe_allow_html=True)

try:
    data = load_snapshot(DB)
except (FileNotFoundError, sqlite3.Error) as exc:
    heading("00", "Workspace not ready", "Opening the dashboard did not create or modify a database.")
    st.error(f"Cannot read the local SQLite database: {exc}")
    st.caption("Check GL_DB or initialize the schema using the project README. Credentials belong in local .env, never in this page.")
    st.stop()
leads, attendees = data["leads"], data["attendees"]
stats = summarize(leads, attendees)
events = sorted({r["event_name"] for r in leads} | {r["event_name"] for r in attendees})

if view == "Overview":
    st.markdown('<div class="hero"><div class="hero-copy"><div class="eyebrow">THE EVENT INTELLIGENCE DESK <span class="slash">/</span> LOCAL SNAPSHOT</div><h1>Find the signal.<br><em>Start the conversation.</em></h1><p>From event discovery to a human-approved introduction. Every number below is persisted in your local pipeline—not a projection.</p><div class="hero-foot"><span class="status-dot"></span> Read-only until you choose an action</div></div><div class="hero-art"><div class="orb">◈</div><span>DISCOVER → REVIEW → CONNECT</span></div></div>', unsafe_allow_html=True)
    section("At a glance", "Non-SEED rows · exact current status")
    cards = (("EVENT LEADS", stats["total"], "Distinct event + domain records", False), ("NOT FOUND BY DOMAIN", stats["ghost"], f'{stats["checked"]} checked against AI Ark', True), ("DRAFT STAGE", stats["stages"]["drafted"], "Not necessarily queued or sent", False), ("RECORDED SENT", stats["sent"], "Needle status = sent", False))
    for col, card in zip(st.columns(4), cards):
        with col: metric(*card)
    left, right = st.columns([1.6, 1], gap="large")
    with left:
        section("Pipeline pulse", "Exclusive stage counts · no double counting")
        maximum = max(stats["total"], 1)
        bars = ''.join(f'<div class="pipeline-row"><span>{clean(LABEL[s])}</span><div class="bar-track"><div class="bar-fill" style="width:{100 * stats["stages"][s] / maximum:.2f}%"></div></div><b>{stats["stages"][s]}</b></div>' for s in STAGES)
        st.markdown(f'<div class="panel">{bars}</div>', unsafe_allow_html=True)
    with right:
        section("Operator briefing", "What's real, what's next")
        note("01 / Unchecked is not ghost", f'{stats["total"] - stats["checked"]} lead records have no persisted AI Ark outcome.')
        note("02 / Local references ≠ delivery", f'{stats["queued"]} persisted draft IDs, including {stats["refs_on_unchecked"]} on unchecked leads. Remote queue not verified.', True)
        note("03 / Approval is human", "A reviewed note can become a Needle draft; a person approves the exact text in Needle before any outreach.")
    if not leads: st.info("No event leads yet. Explore Events for sources and Runs for opt-in processing.")

elif view == "Pipeline":
    heading("01", "The pipeline", "Exclusive current stages—not cumulative conversions or estimated completions.")
    for start in (0, 4):
        for col, stage in zip(st.columns(4), STAGES[start:start + 4]):
            with col: metric(LABEL[stage].upper(), stats["stages"][stage], "persisted records", stage == "drafted")
    section("Where the work sits", "Current stage by event")
    if events: st.dataframe([{"Event": event, **{LABEL[s]: sum(r["event_name"] == event and r["stage"] == s for r in leads) for s in STAGES}} for event in events], hide_index=True, width="stretch")
    else: st.info("No event records yet.")
    cols = st.columns(3)
    with cols[0]: note("AI Ark coverage", f'{stats["checked"]} checked / {stats["total"]} total · {stats["ghost"]} not found by domain.')
    with cols[1]: note("Email validity", f'{stats["valid_emails"]} rows marked valid; the remainder is not assumed valid.')
    with cols[2]: note("Needle outcomes", f'{stats["queued"]} local draft IDs (remote unverified) · {stats["sent"]} recorded sent.')

elif view == "Leads":
    heading("02", "Lead directory", "Inspect evidence, provenance, contact details and the current stored status.")
    a, b, c, d = st.columns([1.4, 1, 1, 1.5])
    with a: selected_events = st.multiselect("Events", events, default=events)
    with b: stage = st.selectbox("Stage", ("All", *STAGES), format_func=lambda s: LABEL.get(s, s))
    with c: aiark = st.selectbox("AI Ark", ("All", "Ghost", "In AI Ark", "Unchecked"))
    with d: search = st.text_input("Find a company or person", placeholder="Company, domain, owner…")
    found = filter_leads(leads, events=set(selected_events), stage=stage, aiark=aiark, search=search)
    section("Records", f"{len(found)} of {len(leads)} shown")
    if found:
        st.dataframe([{"ID": r["id"], "Company": r["company_name"], "Event": r["event_name"], "Stage": LABEL.get(r["stage"], r["stage"]), "AI Ark": "Ghost" if r["in_aiark"] == 0 else "Present" if r["in_aiark"] == 1 else "Unchecked", "Owner": r["owner_name"] or "—", "Email status": r["email_status"] or "—", "Needle status": r["needle_status"] or "—"} for r in found], hide_index=True, width="stretch", height=min(520, len(found) * 42 + 42))
        st.download_button("Download visible rows · CSV", csv_export(found).encode("utf-8-sig"), "ghost-leads-visible.csv", "text/csv")
        options = {f'#{r["id"]} · {r["company_name"]}': r for r in found}
        lead = options[st.selectbox("Inspect one lead", list(options))]
        left, right = st.columns([1.2, 1], gap="large")
        with left:
            section(lead["company_name"], f'#{lead["id"]} · {lead["event_name"]}')
            st.markdown(f'<div class="detail-card"><span>DOMAIN</span><strong>{clean(lead["domain"])}</strong><span>OWNER</span><strong>{clean(lead["owner_name"])} · {clean(lead["owner_title"])}</strong><span>CURRENT STAGE</span><strong>{clean(LABEL.get(lead["stage"], lead["stage"]))}</strong><span>AI ARK</span><strong>{"Not found by domain" if lead["in_aiark"] == 0 else "Present" if lead["in_aiark"] == 1 else "Unchecked"}</strong></div>', unsafe_allow_html=True)
        with right:
            section("Evidence", "Source links from persisted rows")
            for label, field in (("Event source", "event_url"), ("Listing", "source_url"), ("Impressum", "impressum_url"), ("LinkedIn", "linkedin_url")):
                url = safe_url(lead[field])
                if url: st.link_button(label + " ↗", url)
            st.caption(f'Email status: {lead["email_status"] or "unchecked"} · Needle: {lead["needle_status"] or "unknown"}')
            if lead["message"]: st.text_area("Stored note · not proof of delivery", lead["message"], disabled=True, height=130)
    else: st.info("No records match these filters. Broaden your selection to see more.")

elif view == "Draft review":
    heading("03", "Review before contact", "One lead. One exact message. One explicit approval. This page cannot send an invitation.")
    drafts = [r for r in leads if r["stage"] == "drafted" and r["message"] and not r["needle_ref"]]
    section("Unqueued drafts", f'{len(drafts)} with stored text · {stats["queued"]} local draft IDs (remote unverified)')
    if stats["refs_on_unchecked"]:
        st.warning(f'{stats["refs_on_unchecked"]} local draft IDs belong to AI Ark–unchecked leads. Treat these as a provenance conflict, not confirmed queued outreach; inspect records before any approval.')
    if not drafts: st.info("No unqueued drafts with stored text. A stage label alone does not establish a sendable message.")
    else:
        choices = {f'#{r["id"]} · {r["company_name"]} · {r["event_name"]}': r for r in drafts}
        row = choices[st.selectbox("Select a lead", list(choices))]
        left, right = st.columns([1.5, 1], gap="large")
        with left:
            section("The exact note", f'Lead #{row["id"]} · {row["company_name"]}')
            draft_text = st.text_area("Message text", row["message"], height=220, key=f'note_{row["id"]}')
            if draft_text != row["message"]:
                st.caption("Your edit is only in the browser. Save it, then review the persisted version again.")
                if st.button("Save revised draft"):
                    if not draft_text.strip(): st.error("Draft cannot be blank.")
                    else:
                        with closing(sqlite3.connect(DB)) as conn:
                            updated = conn.execute("UPDATE leads SET message=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_name<>? AND stage='drafted' AND COALESCE(in_aiark, 0)=0 AND needle_ref IS NULL AND COALESCE(needle_status,'pending')='pending' AND message=? AND linkedin_url IS ? AND owner_name IS ?", (draft_text.strip(), row["id"], "SEED", row["message"], row["linkedin_url"], row["owner_name"]))
                            conn.commit()
                        if updated.rowcount == 1:
                            st.success("Saved locally. Review the new version before approving.")
                            st.rerun()
                        else: st.error("Draft changed elsewhere. Refresh and review again.")
            reviewed = review_identity(row)
            version = hashlib.sha256(repr(reviewed).encode("utf-8")).hexdigest()[:16]
            approval = st.checkbox("I reviewed this exact text and recipient for this lead and authorize creating one Needle draft for separate human approval in Needle.", key=f'approve_{row["id"]}_{version}')
            eligible = queue_eligible(row, approved=approval, reviewed_message=draft_text, reviewed_identity=reviewed)
            if row["in_aiark"] is None: st.info("AI Ark has not checked this lead yet. It is not counted as a ghost, but you can still review and queue it.")
            elif row["in_aiark"] == 1: st.warning("This lead is already in AI Ark. Queuing is disabled.")
            if not row["linkedin_url"]: st.warning("A LinkedIn profile is required to create a Needle draft.")
            if st.button("Create ONE Needle draft ↗", type="primary", disabled=not eligible):
                try:
                    current = next((r for r in load_snapshot(DB)["leads"] if r["id"] == row["id"]), None)
                    if not current or not queue_eligible(current, approved=approval, reviewed_message=draft_text, reviewed_identity=reviewed):
                        st.error("Recipient or stored draft changed after review. Refresh and approve the current details.")
                    else:
                        from ghostleads.backend import send
                        send.create_reviewed_draft(row["id"], reviewed)
                        after = next((r for r in load_snapshot(DB)["leads"] if r["id"] == row["id"]), None)
                        if after and (after["needle_ref"] or "").startswith("draft:"):
                            st.success("Needle draft confirmed. A person must approve its exact text in Needle before outreach sends.")
                        else: st.error("No Needle draft reference was persisted. Reconcile with Needle before any retry.")
                except Exception as exc: st.error(f"Draft creation stopped ({type(exc).__name__}). No direct send was requested. Check logs.")
        with right:
            section("Decision context", "Verify identity and relevance")
            note("Person", f'{row["owner_name"] or "Unknown"} · {row["owner_title"] or "Title not recorded"} · {row["domain"]}')
            note("AI Ark", "Not found by domain" if row["in_aiark"] == 0 else "Present" if row["in_aiark"] == 1 else "Unchecked", True)
            note("Delivery boundary", "Draft creation is not sending. Review and approve the exact text again inside Needle.")
            url = safe_url(row["linkedin_url"])
            if url: st.link_button("Inspect LinkedIn ↗", url)

elif view == "Runs":
    heading("04", "Run control", "Bounded, opt-in stages. No unattended run, bulk queue, send, or booking.")
    note("SAFETY BOUNDARY", "These steps check AI Ark, enrich, verify or write local drafts. None sends a message.", True)
    steps = (("dedupe", "01 / AI Ark check", "Checks records without an AI Ark outcome.", sum(r["in_aiark"] is None for r in leads)),
             ("enrich", "02 / Enrich domain misses", "Enriches leads not found by AI Ark, or not yet checked.", sum(r["stage"] == "deduped" and r["in_aiark"] != 1 for r in leads)),
             ("verify", "03 / Verify email", "Verifies enriched email data, without sending email.", stats["stages"]["enriched"]),
             ("draft", "04 / Compose notes", "Writes local notes for verified leads with an owner and profile.", sum(bool(r["stage"] == "verified" and r["linkedin_url"] and r["owner_name"]) for r in leads)))
    limit = st.number_input("Maximum leads per step", min_value=1, max_value=100, value=10, step=1)
    for step, title, description, count in steps:
        with st.expander(f"{title} · {count} potentially eligible"):
            st.write(description)
            st.caption("Snapshot estimate. Backend prerequisites may skip or stop this step.")
            confirm = st.checkbox(f"Run {step} for at most {limit} leads", key=f'confirm_{step}')
            if st.button(f"Run {step} stage", disabled=not confirm or count == 0, key=f'run_{step}'):
                try:
                    from ghostleads.backend import automation
                    st.session_state["last_run"] = automation.run_stages([step], limit=int(limit))
                    st.rerun()
                except Exception as exc: st.error(f"Stage stopped ({type(exc).__name__}). Check server logs; no outreach was sent.")
    if "last_run" in st.session_state:
        section("Last run in this browser session", "Actual backend result")
        result = st.session_state["last_run"]
        st.write("Completed:", ", ".join(result["completed"]) or "none", "· Skipped:", ", ".join(result["skipped"]) or "none")
        if result["stopped"]: st.warning(result["stopped"])
        st.dataframe([{"Stage": LABEL[s], "Before": result["before"]["stages"][s], "After": result["after"]["stages"][s]} for s in STAGES], hide_index=True, width="stretch")
    section("Sync provider outcomes", "Explicit Needle read; never sends")
    kind = st.selectbox("Sync type", ("drafts", "replies"), format_func=lambda x: "Draft approval / delivery status" if x == "drafts" else "Inbound reply status")
    accept = st.checkbox("I understand this will request current Needle statuses")
    if st.button("Sync selected statuses", disabled=not accept):
        try:
            from ghostleads.backend import automation
            result = automation.sync(kind)
            st.success(f'Sync complete. Recorded sent: {result["after"]["needle"]["sent"]}; replied: {result["after"]["needle"]["replied"]}.')
        except Exception as exc: st.error(f"Sync stopped ({type(exc).__name__}). Check server logs.")

elif view == "Events":
    heading("05", "Event intelligence", "Configured source definitions are not evidence that a particular person is attending.")
    cards = []
    for path in sorted((ROOT / "events").glob("*.json")):
        try: cards.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError): st.warning(f"Could not read {path.name}.")
    for card in cards:
        name = card.get("name", "Unknown event")
        count = sum(r["event_name"] == name for r in leads)
        found = sum(r["event_name"] == name for r in attendees)
        st.markdown(f'<div class="event-card"><div><span class="eyebrow">EVENT SOURCE / {clean(card.get("city"))}</span><h2>{clean(name)}</h2><p>{clean(card.get("start"))} — {clean(card.get("end"))} · collection window from {clean(card.get("window_start"))}</p></div><div class="event-tally"><strong>{count}</strong><span>LEADS</span><strong>{found}</strong><span>ATTENDEE SIGNALS</span></div></div>', unsafe_allow_html=True)
        url = safe_url(card.get("url"))
        if url: st.link_button(f"Open {name} source ↗", url)
    if not cards: st.info("No event cards in events/*.json.")
    section("Attendance evidence", "Persisted decisions; not lead counts")
    if attendees:
        st.dataframe([{"Event": a["event_name"], "Person": a["person_name"] or "—", "Signal": a["signal"] or "—", "Decision": a["decision"] or "—", "Reason": a["reason"] or "—"} for a in attendees], hide_index=True, width="stretch", height=370)
        st.caption(f'{stats["kept"]} kept · {stats["review"]} needs review · {stats["attendees"]} attendee rows. No outreach inferred.')
    else: st.info("No attendee records in this database (or the table has not been created).")

elif view == "System":
    heading("06", "System & provenance", "Local health, data boundaries and setup—not fabricated provider connectivity.")
    from ghostleads.backend.automation import KEYS
    health = {"database": "ready", "keys": {name: bool(os.getenv(name, "").strip()) for name in KEYS}}
    for col, card in zip(st.columns(3), (("DATABASE", health["database"].upper(), "Read-only on page load"), ("EVENT CARDS", len(list((ROOT / "events").glob("*.json"))), "Configured JSON files"), ("ATTENDEE ROWS", stats["attendees"], "Persisted records"))):
        with col: metric(*card)
    section("Connections", "Key presence only · connectivity not tested")
    for name, present in health["keys"].items(): st.markdown(f'<div class="connection"><span>{clean(name)}</span><strong>{"Configured" if present else "Not configured"}</strong></div>', unsafe_allow_html=True)
    note("Lead database", "Local SQLite supplies lead stages, AI Ark checks, Needle statuses and attendee decisions. SEED is excluded.")
    note("Event definitions", "Dates, cities and source links come from events/*.json; they do not prove attendance.")
    note("Delivery", "A Needle draft is not sent. A person approves the exact text in Needle; explicit sync updates delivery status.", True)
    section("Getting started", "Use README.md and CAPSULE-backend.md")
    st.code(f"GL_DB={DB}\nstreamlit run app/dashboard.py", language="bash")
    st.caption("Install requirements, configure local .env without displaying secrets, initialize the schema, then trigger bounded backend stages intentionally.")

st.markdown('<div class="app-footer"><span>GHOST LEADS / FIELD INTELLIGENCE</span><span>LOCAL-FIRST · HUMAN-APPROVED OUTREACH</span></div>', unsafe_allow_html=True)
