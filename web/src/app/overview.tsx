import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { countStat, countWithPerson, errText, useLists, useListStats, type Stat, type Ws } from "./data";
import { Loading, Notice, PageHead, UsageMeters } from "./ui";

export default function Overview({ ws }: { ws: Ws }) {
  const { lists, error } = useLists(ws);
  const recent = (lists ?? []).slice(0, 6);
  const { stats } = useListStats(ws, recent.map((l) => l.id));
  const [all, setAll] = useState<(Stat & { withPerson: number }) | null>(null);
  const [countErr, setCountErr] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all([countStat(ws.id), countWithPerson(ws.id)])
      .then(([s, withPerson]) => live && setAll({ ...s, withPerson }), (e) => live && setCountErr(errText(e)));
    return () => { live = false; };
  }, [ws.id]);

  const head = <PageHead title={ws.name} sub="Your workspace at a glance. Every number is a count of your own rows."
    action={<Link to="/app/find" className="btn btn-ember btn-sm">Find leads</Link>} />;
  if (error) return <>{head}<Notice kind="err">Could not load your workspace: {error}</Notice></>;
  if (!lists) return <>{head}<Loading /></>;

  const kpis: [number | undefined, string][] = [[lists.length, "Lists"], [all?.total, "Companies"], [all?.enriched, "Enriched"],
    [all?.withEmail, "With an email"], [all?.withPerson, "With a named contact"]];
  return (
    <>
      {head}
      {lists.length === 0 && (
        <div className="card hero-empty">
          <h2 className="h3">Build your first lead list</h2>
          <p className="muted">Search local businesses, startups, companies that are hiring, or any directory page. Then enrich each company
            with emails, people and phone numbers, every fact linked to the page it came from.</p>
          <ol className="steps">
            <li><b>Find</b><span className="small">Pick a source and search, or paste your own domains.</span></li>
            <li><b>Save</b><span className="small">Keep the companies you want in a list.</span></li>
            <li><b>Enrich</b><span className="small">Contacts, tech and a contactability score per company.</span></li>
          </ol>
          <Link to="/app/find" className="btn btn-ember">Find your first leads</Link>
        </div>
      )}
      {countErr && <Notice kind="err">Could not count companies: {countErr}</Notice>}
      <div className="kpis kpis-5" aria-busy={!all && !countErr}>
        {kpis.map(([n, l]) => (
          <div key={l} className="card kpi"><span className="kpi-n num">{n == null ? "–" : n.toLocaleString()}</span><span className="small">{l}</span></div>
        ))}
      </div>
      <div className="grid2">
        <section className="card pad" aria-labelledby="ov-usage">
          <div className="card-head"><h2 className="h4" id="ov-usage">Today’s usage</h2><span className="tag">{ws.plan} plan</span></div>
          <UsageMeters ws={ws} />
        </section>
        <section className="card pad" aria-labelledby="ov-lists">
          <div className="card-head"><h2 className="h4" id="ov-lists">Recent lists</h2>
            {lists.length > 0 && <Link to="/app/lists" className="link small">All lists</Link>}</div>
          {lists.length === 0 ? <p className="muted small">No lists yet. Lists you save from Find leads appear here.</p> : (
            <ul className="rows">
              {recent.map((l) => {
                const s = stats[l.id];
                return (
                  <li key={l.id}>
                    <Link to={`/app/lists/${l.id}`} className="rows-link">
                      <span className="clamp cell-main">{l.name}</span>
                      {s && <span className="small num">{s.total.toLocaleString()} companies · {s.withEmail.toLocaleString()} with email</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
