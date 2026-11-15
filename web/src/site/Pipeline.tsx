import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const STEPS = [
  ["Find", "Run one of the five sources. Each company arrives with a link to where it was listed."],
  ["Enrich", "Ghost Leads reads the company's own website and collects emails, phones, social profiles, named people with titles, the tech stack and a short description."],
  ["Score", "Every company gets a contactability score from 0 to 100, with the reasons written out in plain words."],
  ["Draft", "An AI-written opener that uses only the facts on the record. A person reviews it before anything is sent."],
  ["Export", "Take the whole list with you as a CSV file, whenever you want."],
];

export function Pipeline() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia(root); // selectors below resolve inside this section only
    // Pin only where the whole record fits on screen; everywhere else the section is a plain, fully visible list.
    mm.add("(min-width: 961px) and (min-height: 680px) and (prefers-reduced-motion: no-preference)", () => {
      const el = root.current!;
      const pin = el.querySelector<HTMLElement>(".pipe-pin")!;
      el.classList.add("is-pinned"); // compact layout: one step description shown at a time
      if (pin.offsetHeight > window.innerHeight - 96) return void el.classList.remove("is-pinned");

      const steps = gsap.utils.toArray<HTMLElement>(".pipe-step");
      const texts = gsap.utils.toArray<HTMLElement>(".pipe-step p");
      const parts = gsap.utils.toArray<HTMLElement>(".rec-part");
      gsap.set(steps.slice(1), { opacity: 0.38 });
      gsap.set(texts.slice(1), { opacity: 0 });
      gsap.set(parts.slice(1), { opacity: 0.1, y: 10 });
      gsap.set(".pipe-rail i", { scaleY: 0.2 });

      const tl = gsap.timeline({
        defaults: { ease: "none", duration: 0.5 },
        scrollTrigger: { trigger: pin, start: "top 80px", end: "+=1500", pin: true, scrub: 0.5 },
      });
      for (let i = 1; i < steps.length; i++) {
        tl.to(steps[i - 1], { opacity: 0.38 }, i)
          .to(texts[i - 1], { opacity: 0, duration: 0.2 }, i)
          .to(steps[i], { opacity: 1 }, i)
          .to(texts[i], { opacity: 1, duration: 0.3 }, i + 0.2)
          .to(parts[i], { opacity: 1, y: 0 }, i)
          .to(".pipe-rail i", { scaleY: (i + 1) / steps.length }, i);
      }
      tl.to({}, { duration: 0.4 });
      return () => el.classList.remove("is-pinned");
    });
    return () => mm.revert();
  }, { scope: root });

  return (
    <div ref={root}>
      <div className="pipe-pin">
        <div className="pipe">
          <div className="pipe-copy">
            <h2 className="statement">From a search to a message you would send yourself. <span>One record, five steps, nothing hidden.</span></h2>
            <div className="pipe-list">
              <span className="pipe-rail" aria-hidden><i /></span>
              <ol>
                {STEPS.map(([name, text], i) => (
                  <li key={name} className="pipe-step">
                    <span className="pipe-n num">{i + 1}</span>
                    <div><h3>{name}</h3><p>{text}</p></div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <figure className="rec" aria-label="Illustrative example of one company record moving through the five steps. Not a real lead.">
            <div className="rec-part rec-head">
              <span className="rec-mark" aria-hidden>B</span>
              <div>
                <div className="cell-a">Beispiel Rösterei</div>
                <div className="cell-b mono">beispiel-roesterei.example</div>
              </div>
              <span className="rec-src">Listed on <span className="mono">openstreetmap.org</span></span>
            </div>

            <dl className="rec-part rec-fields">
              <div><dt>Email</dt><dd><span className="mono">hallo@beispiel-roesterei.example</span><span className="tag tag-ok"><span className="dot" />MX ok</span></dd><dd className="rec-on">from <span className="mono">/impressum</span></dd></div>
              <div><dt>Phone</dt><dd className="mono">+49 40 0000 0000</dd><dd className="rec-on">from <span className="mono">/kontakt</span></dd></div>
              <div><dt>Person</dt><dd>Erika Mustermann, Owner</dd><dd className="rec-on">from <span className="mono">/team</span></dd></div>
              <div><dt>Tech</dt><dd><span className="tag">Shopify</span> <span className="tag">Klaviyo</span></dd><dd className="rec-on">from the home page</dd></div>
            </dl>

            <div className="rec-part rec-score">
              <div className="rec-score-n num">86<small>/100</small></div>
              <ul className="ticks">
                <li>Published email on a domain with a mail server</li>
                <li>Named owner on the team page</li>
                <li>Phone number on the contact page</li>
              </ul>
            </div>

            <div className="rec-part rec-draft">
              <div className="rec-draft-top"><b>Opener</b><span className="tag tag-ember">Draft, waiting for your review</span></div>
              <p>Hi Erika, your team page says you run Beispiel Rösterei, and the shop is built on Shopify. We make subscription tools for Shopify roasters. Open to a short call next week?</p>
            </div>

            <div className="rec-part rec-csv">
              <code className="mono">Beispiel Rösterei,hallo@beispiel-roesterei.example,Erika Mustermann,Owner,86</code>
              <span className="tag tag-dark">.csv</span>
            </div>

            <figcaption>Illustrative example · not a real lead</figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}
