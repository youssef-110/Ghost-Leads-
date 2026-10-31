import { useEffect, useRef, useState } from "react";

export type Lead = {
  id: number; event_name: string; company_name: string | null; domain: string; owner_name: string | null;
  owner_title: string | null; linkedin_url: string | null; email: string | null; email_status: string | null;
  in_aiark: number | null; stage: string; needle_status: string | null; message: string | null;
  source_url: string | null; reply_class: string | null; meeting_start: string | null;
};
export type Attendee = {
  id: number; event_name: string; person_name: string | null; headline: string | null; linkedin_url: string;
  signal: string | null; decision: string | null; event_score: number | null; attend_score: number | null;
  reason: string | null; post_url: string | null;
};
export type EventRow = {
  id: string; name: string; city: string | null; start_date: string | null; end_date: string | null;
  url: string | null; search_terms: string[];
};
export type Job = {
  id: number; kind: string; payload: Record<string, unknown>; status: string;
  result: Record<string, unknown> | null; created_at: string; finished_at: string | null;
};

export const STAGES = ["scraped", "deduped", "enriched", "verified", "drafted", "sent", "replied", "booked"] as const;

/** Adds .in to elements with .reveal as they scroll into view. */
export function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
      { rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

/** Counts up to target once the element is visible. */
export function useCountUp(target: number, ms = 1200) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setN(target);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / ms);
        setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [target, ms]);
  return { n, ref };
}

/** Only render links to plain http(s) URLs. */
export const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : undefined);
