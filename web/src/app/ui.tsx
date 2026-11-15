// Small presentational pieces shared by the app screens.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { safeUrl } from "../lib";
import type { EmailStatus, Prospect, Signal, Usage } from "../../shared/types";
import { planLimits, USAGE_KINDS } from "./logic";
import { announce, useUsage, type Ws } from "./data";

export function PageHead({ title, sub, action, back }: { title: string; sub?: string; action?: React.ReactNode; back?: [string, string] }) {
  return (
    <div className="page-head">
      <div className="page-title">
        {back && <Link to={back[0]} className="crumb">← {back[1]}</Link>}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}

export function Tabs({ value, onChange, items, label }: { value: string; onChange: (v: string) => void; items: [string, string][]; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={`tab ${value === v ? "on" : ""}`} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode[]; empty: string }) {
  if (!children.length) return <div className="card empty"><p className="muted">{empty}</p></div>;
  return <div className="card table-wrap"><table><thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export function Notice({ kind, children }: { kind: "err" | "ok" | "info"; children: React.ReactNode }) {
  return <div className={`notice notice-${kind}`} role={kind === "err" ? "alert" : "status"}>{children}</div>;
}

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <div className="card empty center" role="status"><span className="spinner" /><span className="small">{label}</span></div>
);

/** A link only when the URL is plain http(s); otherwise the same content as text. Scraped URLs are never linked blindly. */
export function Ext({ href, children, className = "link" }: { href: string | null | undefined; children: React.ReactNode; className?: string }) {
  const u = safeUrl(href);
  if (u) return <a className={className} href={u} target="_blank" rel="noreferrer noopener">{children}</a>;
  return className === "link" ? <>{children}</> : <span className={className}>{children}</span>;
}

/** "Source" style link that simply is not there when the URL is missing or unsafe. */
export const SrcLink = ({ href, label = "Source" }: { href: string | null | undefined; label?: string }) =>
  safeUrl(href) ? <a className="link small" href={safeUrl(href)} target="_blank" rel="noreferrer noopener">{label}</a> : null;

const EMAIL_TAG: Record<EmailStatus, string> = { valid: "tag-ok", risky: "tag-ember", invalid: "tag-err", unknown: "" };
export const EmailTag = ({ status }: { status: EmailStatus }) => (
  <span className={`tag ${EMAIL_TAG[status] ?? ""}`}>{status === "unknown" ? "unchecked" : status}</span>
);

const STATUS_TAG: Record<Prospect["status"], [string, string]> = {
  new: ["", "New"], enriching: ["tag-ember", "Enriching"], enriched: ["tag-ok", "Enriched"], failed: ["tag-err", "Failed"],
};
export function StatusTag({ status, title }: { status: Prospect["status"]; title?: string | null }) {
  const [cls, label] = STATUS_TAG[status] ?? ["", status];
  return <span className={`tag ${cls}`} title={title ?? undefined}>{status === "enriching" && <span className="dot pulse" />}{label}</span>;
}

export function SignalChips({ signals, max = 3 }: { signals: Signal[] | null | undefined; max?: number }) {
  const s = signals ?? [];
  if (!s.length) return <span className="faint">—</span>;
  return (
    <span className="chips">
      {s.slice(0, max).map((x, i) => <Ext key={i} href={x.url} className="tag tag-link"><span className={`sig sig-${x.kind}`} />{x.label}</Ext>)}
      {s.length > max && <span className="tag">+{s.length - max}</span>}
    </span>
  );
}

const KIND_LABEL: Record<Usage["kind"], string> = {
  discover: "Searches", enrich: "Enrichments", extract: "Page scrapes", draft: "AI drafts", verify: "Email checks",
};
/** Today's usage against the plan's daily limits. */
export function UsageMeters({ ws }: { ws: Ws }) {
  const { used, error } = useUsage(ws);
  const limits = planLimits(ws.plan);
  if (error) return <Notice kind="err">Could not load usage: {error}</Notice>;
  return (
    <div className="meters" aria-busy={!used}>
      {USAGE_KINDS.map((k) => {
        const n = used?.[k] ?? 0, full = n >= limits[k];
        return (
          <div key={k} className="meter">
            <div className="meter-top"><span>{KIND_LABEL[k]}</span>
              <span className="num small">{used ? n.toLocaleString() : "–"} / {limits[k].toLocaleString()}</span></div>
            <div className={`bar ${full ? "bar-full" : ""}`} role="progressbar" aria-label={`${KIND_LABEL[k]} used today`}
              aria-valuemin={0} aria-valuemax={limits[k]} aria-valuenow={n}>
              <span style={{ transform: `scaleX(${Math.min(1, n / limits[k])})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Destructive actions need a second click; it disarms on blur or after a few seconds. */
export function ConfirmButton({ label, confirm = "Confirm", onConfirm, disabled, className = "btn btn-line btn-sm", ariaLabel }:
  { label: string; confirm?: string; onConfirm: () => void; disabled?: boolean; className?: string; ariaLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`${className} ${armed ? "danger" : ""}`} disabled={disabled} onBlur={() => setArmed(false)}
      aria-label={ariaLabel && (armed ? `${confirm}: ${ariaLabel}` : ariaLabel)}
      onClick={(e) => { e.stopPropagation(); if (armed) onConfirm(); setArmed(!armed); }}>
      {armed ? confirm : label}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button type="button" className="btn btn-line btn-xs" disabled={!text}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); announce("Copied"); }, () => announce("Could not copy"))}>
      {done ? "Copied" : label}
    </button>
  );
}
