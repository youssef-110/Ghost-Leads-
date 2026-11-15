import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

// Everything below is fictional. Names are placeholder names and every domain uses the reserved .example ending.
type Row = [company: string, domain: string, mailbox: string, mx: boolean, person: string | null, title: string, tech: string[], score: number];
type Source = { id: string; label: string; icon: string; fields: [label: string, value: string][]; from: string; foundOn: string; rows: Row[] };

const SOURCES: Source[] = [
  {
    id: "local", label: "Local", icon: "M9 16s5-4.6 5-8.5A5 5 0 0 0 4 7.5C4 11.4 9 16 9 16zM9 9.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z",
    fields: [["Category", "coffee roasters"], ["City", "Hamburg"]], from: "OpenStreetMap data", foundOn: "/impressum",
    rows: [
      ["Beispiel Rösterei", "beispiel-roesterei.example", "hallo", true, "Erika Mustermann", "Owner", ["Shopify", "Klaviyo"], 86],
      ["Muster Kaffee Kontor", "muster-kontor.example", "info", true, "Max Mustermann", "Managing director", ["WooCommerce"], 78],
      ["Fiktiv & Bohne", "fiktiv-bohne.example", "kontakt", false, null, "", ["Squarespace"], 54],
      ["Platzhalter Coffee Lab", "platzhalter-lab.example", "team", true, "Jane Doe", "Head roaster", ["Shopify"], 81],
    ],
  },
  {
    id: "web", label: "Web search", icon: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12 12l4 4",
    fields: [["Search", "industrial 3D printing service Germany"]], from: "web search results", foundOn: "/kontakt",
    rows: [
      ["Muster Additive GmbH", "muster-additive.example", "vertrieb", true, "Max Mustermann", "Head of sales", ["WordPress", "HubSpot"], 88],
      ["Beispiel 3D Druck", "beispiel-3d.example", "info", true, "Erika Musterfrau", "Founder", ["Webflow"], 79],
      ["Fiktiv Prototyping", "fiktiv-proto.example", "anfrage", true, null, "", ["TYPO3"], 63],
      ["Sample Layerworks", "sample-layerworks.example", "hello", false, "John Doe", "Operations", ["Shopify"], 58],
    ],
  },
  {
    id: "startups", label: "Startups", icon: "M9 2c3 2 4.5 5 4.5 8.5L11 13H7l-2.500-2.500C4.500 7 6 4 9 2zM7 13l-1 3M11 13l1 3M9 8.200a1.200 1.200 0 1 0 0-2.400 1.200 1.200 0 0 0 0 2.400z",
    fields: [["Industry", "developer tools"], ["Filter", "hiring now"]], from: "the open Y Combinator dataset", foundOn: "/about",
    rows: [
      ["Placeholder Labs", "placeholder-labs.example", "founders", true, "Jane Doe", "Co-founder", ["Next.js", "Vercel"], 90],
      ["Samplestack", "samplestack.example", "hello", true, "John Doe", "CEO", ["React", "Stripe"], 84],
      ["Fictional CI", "fictional-ci.example", "team", true, "Alex Example", "CTO", ["Astro"], 76],
      ["Mockingbird Dev", "mockingbird-dev.example", "hi", false, null, "", ["Next.js"], 52],
    ],
  },
  {
    id: "hiring", label: "Hiring", icon: "M3 6.500h12v8H3zM6.500 6.500V4.500h5v2M3 10h12",
    fields: [["Role", "Head of RevOps"], ["Location", "Netherlands"]], from: "public job feeds", foundOn: "/team",
    rows: [
      ["Voorbeeld Software BV", "voorbeeld-software.example", "jobs", true, "Jan Jansen", "VP Sales", ["HubSpot", "Segment"], 85],
      ["Sample Freight", "sample-freight.example", "people", true, "Jane Doe", "COO", ["Salesforce"], 80],
      ["Fictief Payments", "fictief-payments.example", "careers", true, null, "", ["Greenhouse"], 62],
      ["Example Analytics", "example-analytics.example", "hello", true, "John Doe", "Founder", ["Webflow", "Intercom"], 77],
    ],
  },
  {
    id: "directory", label: "Directory", icon: "M3 4.500h12M3 9h12M3 13.500h12M5.500 4.500v9",
    fields: [["List page", "messe-beispiel.example/exhibitors"]], from: "the list page you gave it", foundOn: "/contact",
    rows: [
      ["Muster Maschinenbau AG", "muster-maschinenbau.example", "messe", true, "Max Mustermann", "Trade fair manager", ["TYPO3"], 82],
      ["Exempel Robotics", "exempel-robotics.example", "sales", true, "Erik Exempel", "Sales director", ["WordPress"], 80],
      ["Fiktiva Sensors Oy", "fiktiva-sensors.example", "info", false, null, "", ["Drupal"], 49],
      ["Sample Dynamics Ltd", "sample-dynamics.example", "enquiries", true, "Jane Doe", "Marketing lead", ["HubSpot"], 74],
    ],
  },
];

/** A cell that starts as a skeleton and fills in. Without motion the value is simply there. */
function Fill({ col, children }: { col: number; children: React.ReactNode }) {
  return (
    <td data-col={col}>
      <span className="sk" aria-hidden />
      <div className="val">{children}</div>
    </td>
  );
}

export function HeroTable() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const touched = useRef(false);
  const src = SOURCES[active];

  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.set(".q-cover", { scaleX: 1 });
    gsap.set(".q-caret", { opacity: 1 });
    gsap.set("tbody tr", { opacity: 0, y: 8 });
    gsap.set(".sk", { autoAlpha: 1 });
    gsap.set(".val", { opacity: 0 });
    gsap.set(".meter i", { scaleX: 0 });
    gsap.set(".pop", { opacity: 0, y: 6 });

    // On first load the table waits for the headline; after a click it answers at once.
    const tl = gsap.timeline({ delay: touched.current ? 0.05 : 0.9, defaults: { ease: "power3.out" } });
    gsap.utils.toArray<HTMLElement>(".q-val").forEach((val) => {
      const steps = Math.max(6, Math.round(val.offsetWidth / 9));
      const duration = Math.min(0.9, steps * 0.035);
      tl.to(val.querySelector(".q-cover"), { scaleX: 0, duration, ease: `steps(${steps})` })
        .to(val.querySelector(".q-caret"), { x: val.offsetWidth, duration, ease: `steps(${steps})` }, "<")
        .set(val.querySelector(".q-caret"), { opacity: 0 }, ">0.1");
    });
    tl.to(".q-run", { scale: 0.95, duration: 0.09, yoyo: true, repeat: 1, ease: "power1.inOut" })
      .to("tbody tr", { opacity: 1, y: 0, duration: 0.45, stagger: 0.07, clearProps: "transform" }, ">0.05")
      .addLabel("enrich", ">0.1");
    [1, 2, 3, 4].forEach((col, k) => {
      const at = `enrich+=${k * 0.32}`;
      tl.to(`[data-col="${col}"] .sk`, { autoAlpha: 0, duration: 0.2, stagger: 0.07 }, at)
        .to(`[data-col="${col}"] .val`, { opacity: 1, duration: 0.4, stagger: 0.07 }, at);
    });
    tl.to(".meter i", { scaleX: 1, duration: 0.8, stagger: 0.07 }, "enrich+=0.96");
    gsap.utils.toArray<HTMLElement>(".score-n").forEach((el, k) => {
      const n = { v: 0 };
      tl.to(n, { v: Number(el.dataset.n), duration: 0.8, onUpdate: () => { el.textContent = String(Math.round(n.v)); } }, `enrich+=${0.96 + k * 0.07}`);
    });
    tl.to(".pop", { opacity: 1, y: 0, duration: 0.45 }, ">-0.1");
  }, { scope: root, dependencies: [active], revertOnUpdate: true });

  return (
    <figure ref={root} className="win" aria-label="Illustrative example of a Ghost Leads list. The companies and people are not real.">
      <div className="win-tabs" role="group" aria-label="Lead source for the example">
        {SOURCES.map((s, i) => (
          <button key={s.id} type="button" className="win-tab" aria-pressed={i === active}
            onClick={() => { touched.current = true; setActive(i); }}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path d={s.icon} /></svg>
            {s.label}
          </button>
        ))}
      </div>

      <div className="win-query" key={src.id}>
        {src.fields.map(([label, value]) => (
          <span key={label} className="q-field">
            <span className="q-label">{label}</span>
            <span className="q-val mono">{value}<span className="q-cover" aria-hidden /><span className="q-caret" aria-hidden /></span>
          </span>
        ))}
        <span className="q-run" aria-hidden>Find companies</span>
      </div>

      <div className="win-table">
        <table>
          <caption className="sr">Four example companies found from {src.from}, enriched from their own websites.</caption>
          <thead>
            <tr><th scope="col">Company</th><th scope="col">Email</th><th scope="col" className="c-wide">Person</th><th scope="col" className="c-wide">Tech</th><th scope="col">Score</th></tr>
          </thead>
          <tbody key={src.id}>
            {src.rows.map(([company, domain, mailbox, mx, person, title, tech, score], r) => (
              <tr key={domain}>
                <td>
                  <div className="cell-a">{company}</div>
                  <div className="cell-b mono">{domain}</div>
                </td>
                <Fill col={1}>
                  <div className="cell-a mono">{mailbox}@{domain}</div>
                  <div className={`cell-b mx ${mx ? "mx-ok" : ""}`}><span className="dot" />{mx ? "MX ok" : "Risky, guessed pattern"}</div>
                  {r === 0 && (
                    <div className="pop" role="note">
                      <b>Found on the page</b> <span className="mono">{src.foundOn}</span>
                      <span className="pop-sub">The domain has a mail server (MX record)</span>
                    </div>
                  )}
                </Fill>
                <Fill col={2}>
                  {person
                    ? <><div className="cell-a">{person}</div><div className="cell-b">{title}</div></>
                    : <div className="cell-b">No named person found</div>}
                </Fill>
                <Fill col={3}>
                  <div className="tech">{tech.map((t) => <span key={t} className="tag">{t}</span>)}</div>
                </Fill>
                <Fill col={4}>
                  <div className="cell-a num score-n" data-n={score}>{score}</div>
                  <div className="meter"><i style={{ width: `${score}%` }} /></div>
                </Fill>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="win-foot">
        <span>Illustrative example · not a real lead</span>
        <span className="win-from">Companies from {src.from}</span>
      </figcaption>
    </figure>
  );
}
