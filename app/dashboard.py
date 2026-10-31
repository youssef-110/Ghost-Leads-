"""Ghost Leads dashboard: streamlit run app/dashboard.py

Every number comes from real rows in the DB or from live provider balances. SEED rows never count.
"""
import sys
from pathlib import Path

import httpx
import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from ghostleads import db  # noqa: E402
from ghostleads.backend import attendees, send  # noqa: E402
from ghostleads.backend.config import SEED_EVENT, connect, key  # noqa: E402

st.set_page_config(page_title="Ghost Leads", layout="wide")
conn = connect()
conn.execute(attendees.TABLE)

leads = pd.read_sql("SELECT * FROM leads WHERE event_name<>? ORDER BY id", conn, params=(SEED_EVENT,))
att = pd.read_sql("SELECT * FROM attendees ORDER BY attend_score DESC", conn)
events = sorted(set(leads.event_name) | set(att.event_name))
pick = st.sidebar.multiselect("Events", events, default=events)
leads, att = leads[leads.event_name.isin(pick)], att[att.event_name.isin(pick)]
st.title("Ghost Leads")
st.caption("Companies and people at an event that no lead database knows, enriched and contacted on LinkedIn.")

# ---- funnel: a lead counts for every stage it has reached
order = list(db.STAGES)
reached = {s: int((leads.stage.map(order.index) >= i).sum()) for i, s in enumerate(order)}
ghosts = leads[leads.in_aiark == 0]
cols = st.columns(8)
cols[0].metric("Attendees kept", int((att.decision == "keep").sum()), f"of {len(att)} found")
for col, s in zip(cols[1:], order[:7]):
    col.metric(s.capitalize(), reached[s])
c1, c2, c3 = st.columns(3)
checked = leads.in_aiark.notna().sum()
c1.metric("NOT in AI Ark (ghosts)", len(ghosts), f"of {checked} checked" if checked else "AI Ark not checked yet")
c2.metric("Verified emails", int((leads.email_status == "valid").sum()))
c3.metric("Needle touches sent", int((leads.needle_status == "sent").sum()))

# ---- cost per verified ghost lead, from live balances
with st.sidebar.expander("Cost inputs (USD per unit)"):
    blitz_price = st.number_input("Blitz record", value=99 / 200_000, format="%.5f")
    aiark_price = st.number_input("AI Ark credit", value=0.0, format="%.4f")
    aiark_start = st.number_input("AI Ark credits at start", value=100.0)


@st.cache_data(ttl=120)
def balances():
    out = {}
    try:
        j = httpx.get("https://api.blitz-api.ai/v2/account/key-info",
                      headers={"x-api-key": key("BLITZ_API_KEY")}, timeout=10).json()
        out["blitz_used"] = 1000 - j["records_remaining"]  # free monthly allowance
    except Exception:
        out["blitz_used"] = None
    try:
        r = httpx.get("https://api.ai-ark.com/api/developer-portal/v1/payments/credits",
                      headers={"X-TOKEN": key("AIARK_API_KEY")}, timeout=10)
        out["aiark_left"] = r.json()["total"] if r.is_success else None
    except Exception:
        out["aiark_left"] = None
    return out


b = balances()
verified_ghosts = int(((leads.in_aiark == 0) & (leads.stage.map(order.index) >= order.index("verified"))).sum())
spend = (b["blitz_used"] or 0) * blitz_price + ((aiark_start - b["aiark_left"]) * aiark_price
                                                 if b["aiark_left"] is not None else 0)
c1, c2, c3 = st.columns(3)
c1.metric("Blitz records used", b["blitz_used"] if b["blitz_used"] is not None else "n/a")
c2.metric("AI Ark credits left", b["aiark_left"] if b["aiark_left"] is not None else "API blocked")
c3.metric("Cost per verified ghost lead", f"${spend / verified_ghosts:.3f}" if verified_ghosts else "no verified ghosts yet")

tab_leads, tab_att, tab_msg, tab_one = st.tabs(["Leads", "Attendees", "Messages", "One lead, every stage"])

with tab_leads:
    view = leads.assign(badge=leads.in_aiark.map({0: "NOT IN AI ARK", 1: "in AI Ark"}).fillna("not checked"))
    st.dataframe(view[["id", "event_name", "company_name", "domain", "badge", "owner_name", "owner_title",
                       "linkedin_url", "email", "email_status", "stage", "needle_status"]],
                 use_container_width=True, hide_index=True,
                 column_config={"linkedin_url": st.column_config.LinkColumn("LinkedIn")})
    # scraped text can start with = + - @: prefix a quote so spreadsheets do not run it as a formula
    risky = ("=", "+", "-", "@", "\t", "\r")
    safe = view.map(lambda v: "'" + v if isinstance(v, str) and (v[:1] in risky or v.lstrip()[:1] in risky) else v)
    st.download_button("Export CSV", safe.to_csv(index=False).encode("utf-8"), "ghost_leads.csv", "text/csv")

with tab_att:
    st.caption("From LinkedIn posts and comments. Keep = both scores 70+, discard = any score under 40, else review.")
    review = att[att.decision == "review"]
    for _, a in review.iterrows():  # human check for the uncertain middle
        with st.container(border=True):
            st.markdown(f"**{a.person_name}**: {a.headline or ''}  \n{a.reason}")
            st.write((a.comment_text or a.post_text or "")[:400])
            k, d = st.columns(2)
            if k.button("Keep", key=f"k{a.id}"):
                conn.execute("UPDATE attendees SET decision='keep' WHERE id=?", (int(a.id),)); conn.commit(); st.rerun()
            if d.button("Discard", key=f"d{a.id}"):
                conn.execute("UPDATE attendees SET decision='discard', reason='discarded in review' WHERE id=?",
                             (int(a.id),)); conn.commit(); st.rerun()
    st.dataframe(att[["person_name", "headline", "signal", "event_score", "attend_score", "decision", "reason",
                      "linkedin_url", "post_url"]], use_container_width=True, hide_index=True,
                 column_config={"linkedin_url": st.column_config.LinkColumn("LinkedIn"),
                                "post_url": st.column_config.LinkColumn("Post")})

with tab_msg:
    st.caption("Edit, then queue in Needle. Nothing sends until a person approves it in the Needle inbox.")
    for _, r in leads[leads.message.notna()].iterrows():
        with st.container(border=True):
            st.markdown(f"**{r.owner_name}**, {r.owner_title or ''} at {r.company_name} · [{r.event_name}]"
                        f"({r.source_url or r.event_url}) · stage `{r.stage}` · Needle `{r.needle_status}`")
            text = st.text_area("Note", r.message, key=f"m{r.id}", max_chars=300, label_visibility="collapsed")
            s, q = st.columns(2)
            if s.button("Save edit", key=f"s{r.id}"):
                db.update(conn, int(r.id), message=text); st.rerun()
            if q.button("Queue in Needle for review", key=f"q{r.id}", disabled=bool(r.needle_ref)):
                db.update(conn, int(r.id), message=text)
                send.main(["--draft", "--ids", str(int(r.id))]); st.rerun()

with tab_one:
    if len(leads):
        by_id = leads.set_index("id").astype(object)
        r = by_id.loc[st.selectbox("Lead", by_id.index, format_func=lambda i: f"{i}: {by_id.loc[i, 'company_name']}")]
        r = r.where(pd.notna(r), None)  # NaN -> None so "or" fallbacks work
        steps = [("scraped", f"Found at **{r.event_name}**: {r.company_name} ({r.domain}). Source: {r.source_url or r.event_url}"),
                 ("deduped", {0: "Checked against AI Ark: **NOT IN AI ARK**, a ghost.", 1: "Already in AI Ark."}
                  .get(r.in_aiark, "AI Ark check pending.")),
                 ("enriched", f"Person: **{r.owner_name or '-'}**, {r.owner_title or '-'}. LinkedIn: {r.linkedin_url or '-'} "
                              f"(source: {r.enrichment_source or '-'})"),
                 ("verified", f"Email: {r.email or '-'} → `{r.email_status or '-'}`"),
                 ("drafted", f"Note:\n\n> " + (r.message or "-").replace("\n", "\n> ")),
                 ("sent", f"Needle: `{r.needle_status}` {r.needle_ref or ''}")]
        for s, text in steps:
            done = order.index(r.stage) >= order.index(s)
            st.markdown(f"{'✅' if done else '⬜'} **{s}** · {text if done or s == 'deduped' else ''}")
