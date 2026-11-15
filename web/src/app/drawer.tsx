import { useEffect, useRef, useState } from "react";
import type { Prospect } from "../../shared/types";
import { api } from "./api";
import { safeUrl } from "../lib";
import { errText, type Ws } from "./data";
import { bestPerson } from "./logic";
import { CopyButton, EmailTag, Ext, Notice, SrcLink, StatusTag, Tabs } from "./ui";

const offerKey = (ws: Ws) => `gl:offer:${ws.id}`;
const readOffer = (ws: Ws) => { try { return localStorage.getItem(offerKey(ws)) ?? ""; } catch { return ""; } };

type Props = {
  p: Prospect; ws: Ws; busy: boolean;
  /** Result of the last run on the page behind; shown here too because that page is inert while the drawer is open. */
  note?: { kind: "ok" | "err" | "info"; text: string } | null;
  patch: (id: number, patch: Partial<Prospect>) => Promise<void>;
  onEnrich: () => void; onClose: () => void;
};

/** Everything known about one company. A native modal dialog: focus is trapped, Esc closes, focus returns to the row. */
export function ProspectDrawer({ p, ws, busy, note, patch, onEnrich, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // focus the panel itself, not its first link: keyboard users Tab in from the top, mouse users see no stray ring
  useEffect(() => { if (ref.current && !ref.current.open) { ref.current.showModal(); ref.current.focus(); } }, []);
  const close = () => ref.current?.close();
  /** A modal dialog already makes the page behind inert; this keeps Tab from stopping on the browser's own UI in between. */
  function wrapTab(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "Tab") return;
    const stops = e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:enabled, input:enabled, textarea:enabled, select:enabled");
    const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
    if (e.shiftKey ? at === first || at === e.currentTarget : at === last) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
  }

  const [notes, setNotes] = useState(p.notes ?? "");
  const [message, setMessage] = useState(p.message ?? "");
  const [saved, setSaved] = useState<{ field: string; text: string; err?: boolean } | null>(null);
  const [channel, setChannel] = useState<"email" | "linkedin">("email");
  const [offer, setOffer] = useState(() => readOffer(ws));
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState("");

  async function saveField(field: "notes" | "message", value: string) {
    if (value === (p[field] ?? "")) return;
    setSaved({ field, text: "Saving…" });
    try {
      await patch(p.id, { [field]: value.trim() ? value : null });
      setSaved({ field, text: "Saved" });
    } catch (e) {
      setSaved({ field, text: `Not saved: ${errText(e)}`, err: true });
    }
  }
  const savedNote = (field: string) => saved?.field === field && <span className={`small ${saved.err ? "warn" : ""}`} role="status">{saved.text}</span>;

  const person = bestPerson(p.people);
  async function draft() {
    setDrafting(true); setDraftErr("");
    try { localStorage.setItem(offerKey(ws), offer); } catch { /* private mode: the offer is just not remembered */ }
    try {
      const r = await api.draft({
        ws: ws.id, channel, offer: offer.trim(),
        prospect: { company_name: p.company_name, description: p.description, industry: p.industry, city: p.city, signals: p.signals ?? [], person, tech: p.tech ?? [] },
      });
      const text = r.subject ? `Subject: ${r.subject}\n\n${r.message}` : r.message;
      setMessage(text);
      await saveField("message", text);
    } catch (e) {
      setDraftErr(errText(e));
    } finally {
      setDrafting(false);
    }
  }

  const emails = p.emails ?? [], people = p.people ?? [];
  const sourceEmail = p.email && !emails.some((e) => e.email === p.email) ? p.email : null;
  const phones = [...new Set([p.phone, ...(p.phones ?? [])].filter((x): x is string => !!x))];
  const socials = Object.entries(p.socials ?? {}).filter(([, u]) => safeUrl(u));
  const place = [p.address, p.city, p.country].filter(Boolean).join(", ");

  return (
    <dialog ref={ref} className="drawer" tabIndex={-1} aria-labelledby="dr-title" onClose={onClose} onKeyDown={wrapTab} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="drawer-in">
        <header className="drawer-head">
          <div className="drawer-title">
            <h2 id="dr-title">{p.company_name}</h2>
            <p className="small">{p.domain ? <Ext href={p.website ?? `https://${p.domain}`}>{p.domain}</Ext> : "No website"}{p.industry ? ` · ${p.industry}` : ""}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={`Close ${p.company_name}`} onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className="drawer-meta">
          <span role="status"><StatusTag status={p.status} /></span>
          <span className="small">Found via {p.source}</span>
          <SrcLink href={p.source_url} label="Source page" />
          <button type="button" className="btn btn-line btn-xs push" disabled={!p.domain || busy} onClick={onEnrich}
            title={p.domain ? undefined : "This company has no website to enrich"}>
            {p.status === "enriching" ? "Enriching…" : p.status === "enriched" ? "Re-enrich" : "Enrich"}
          </button>
        </div>
        {p.status === "failed" ? <Notice kind="err">Enrichment failed: {p.error || "no reason given"}</Notice>
          : note?.kind === "err" && <Notice kind="err">{note.text}</Notice>}

        <Section title="Score" empty={p.score == null}>
          <div className="score">
            <span className="score-n num">{p.score}</span>
            <ul className="reasons">{(p.score_reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        </Section>

        <Section title="Emails" count={emails.length + (sourceEmail ? 1 : 0)} empty={!emails.length && !sourceEmail}>
          <ul className="facts">
            {emails.map((e, i) => (
              <li key={i}>
                <div className="fact-main"><span className="mono">{e.email}</span><span className="tag">{e.kind}</span><EmailTag status={e.status} /></div>
                <div className="fact-sub">{e.reason && <span className="small">{e.reason}</span>}<SrcLink href={e.source_url} /></div>
                <CopyButton text={e.email} />
              </li>
            ))}
            {sourceEmail && (
              <li>
                <div className="fact-main"><span className="mono">{sourceEmail}</span><EmailTag status="unknown" /></div>
                <div className="fact-sub"><span className="small">Listed by the {p.source} source</span><SrcLink href={p.source_url} /></div>
                <CopyButton text={sourceEmail} />
              </li>
            )}
          </ul>
        </Section>

        <Section title="People" count={people.length} empty={!people.length}>
          <ul className="facts">
            {people.map((x, i) => (
              <li key={i}>
                <div className="fact-main"><span className="cell-main">{x.name}</span>{x.title && <span className="small">{x.title}</span>}</div>
                <div className="fact-sub">{x.email && <span className="mono small">{x.email}</span>}<SrcLink href={x.linkedin} label="LinkedIn" /><SrcLink href={x.source_url} /></div>
                {x.email && <CopyButton text={x.email} />}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Phones" count={phones.length} empty={!phones.length}>
          <ul className="facts">{phones.map((n) => <li key={n}><div className="fact-main"><span className="num">{n}</span></div><CopyButton text={n} /></li>)}</ul>
        </Section>

        <Section title="Socials" empty={!socials.length}>
          <div className="chips">{socials.map(([k, u]) => <Ext key={k} href={u} className="tag tag-link">{k}</Ext>)}</div>
        </Section>
        <Section title="Tech" empty={!(p.tech ?? []).length}>
          <div className="chips">{(p.tech ?? []).map((t) => <span key={t} className="tag">{t}</span>)}</div>
        </Section>
        <Section title="Signals" empty={!(p.signals ?? []).length}>
          <ul className="facts">{(p.signals ?? []).map((s, i) => (
            <li key={i}><div className="fact-main"><span className="tag">{s.kind}</span><span>{s.label}</span></div><SrcLink href={s.url} /></li>
          ))}</ul>
        </Section>
        <Section title="About" empty={!p.description}>
          <p className="about">{p.description}</p>
        </Section>
        <Section title="Address" empty={!place}>
          <p className="about">{place}</p>
        </Section>

        <Section title="Notes" aside={savedNote("notes")}>
          <textarea className="input" aria-label="Notes" rows={3} maxLength={4000} value={notes} placeholder="Private notes for your team"
            onChange={(e) => setNotes(e.target.value)} onBlur={() => saveField("notes", notes)} />
        </Section>

        <Section title="Draft opener" aside={savedNote("message")}>
          <Tabs value={channel} onChange={(v) => setChannel(v as "email" | "linkedin")} items={[["email", "Email"], ["linkedin", "LinkedIn"]]} label="Channel" />
          <label className="field"><span className="label">What you offer</span>
            <textarea className="input" rows={2} maxLength={600} value={offer} onChange={(e) => setOffer(e.target.value)}
              placeholder="We help dental clinics fill last-minute cancellations with an SMS waitlist." /></label>
          <button type="button" className="btn btn-ember btn-sm" disabled={drafting || !offer.trim()} onClick={draft}>
            {drafting ? <><span className="spinner spinner-sm" /> Drafting…</> : message ? "Draft again" : "Draft opener"}
          </button>
          {draftErr && <Notice kind="err">{draftErr}</Notice>}
          <label className="field msg-field"><span className="label">Message{person ? ` to ${person.name}` : ""}</span>
            <textarea className="input" rows={7} maxLength={4000} value={message} placeholder="Your draft appears here. You can also write your own."
              onChange={(e) => setMessage(e.target.value)} onBlur={() => saveField("message", message)} /></label>
          <div className="drawer-foot">
            <span className="small">Nothing is sent from Ghost Leads. Copy the message and send it yourself.</span>
            <CopyButton text={message} label="Copy message" />
          </div>
        </Section>
      </div>
    </dialog>
  );
}

/** A missing fact collapses to one line with a dash, so an un-enriched company stays scannable. */
function Section({ title, count, aside, empty, children }: { title: string; count?: number; aside?: React.ReactNode; empty?: boolean; children: React.ReactNode }) {
  return (
    <section className={`dr-sec ${empty ? "dr-empty" : ""}`}>
      <div className="dr-sec-head"><h3>{title}{count ? <span className="num faint"> {count}</span> : null}</h3>{empty ? <span className="faint">—</span> : aside}</div>
      {!empty && children}
    </section>
  );
}
