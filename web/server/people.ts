// Named people with a role, from one page. Three sources: schema.org Person, team cards, German Impressum lines.
// Conservative on purpose: a person is only returned with a plausible name AND a role the page states.
import type { Person } from "../shared/types.js";
import { clean, jsonLd, ldTypes, type CheerioAPI } from "./html.js";

const PARTICLES = new Set(["von", "van", "de", "der", "den", "zu", "zur", "da", "di", "du", "la", "le", "del", "bin", "al", "el", "ter", "ten"]);
const NOT_NAMES = /\b(gmbh|mbh|ag|ug|kg|ohg|gbr|ltd|llc|inc|corp|co|company|team|contact|kontakt|about|über|uber|unser|unsere|our|the|und|and|services?|solutions?|privacy|policy|datenschutz|impressum|imprint|read|more|mehr|learn|home|news|blog|press|careers?|jobs|street|straße|strasse|road|avenue|platz|weg|group|holding|management|marketing|sales|support|consulting|software|digital|media|studio|design|partners?|international|global|germany|deutschland|europe|usa|new|york|san|francisco|los|angeles|london|berlin|münchen|hamburg|customer|success|stories|case|study|get|started|sign|log|free|demo|pricing|product|products|platform|features|resources|terms|legal|cookie|cookies|all|rights|reserved|follow|us|join|meet|leadership|board|directors|executive|officer|chief|head|vice|president|founder|ceo|cto|cfo|coo|cmo|geschäftsführer|geschäftsführerin|geschäftsführung|inhaber|inhaberin|vorstand|vertreten|durch|registergericht|amtsgericht|handelsregister|umsatzsteuer|telefon|email|mail|fax|tel)\b/i;
// case-sensitive: "Ma" and "Ing" are also real names
const HONORIFICS = /\b(?:Herr|Frau|Mr|Mrs|Ms|Dr|Prof|Dipl|Ing|Kfm|Kffr|Inf|med|dent|rer|nat|jur|phil|h\.\s?c|MBA|MSc|BSc|M\.A|B\.A|Ph\.?D|LL\.?M|RA|StB|WP)\b\.?(?:-(?=[A-Za-z]))?/g;

/** "Dr. Max Mustermann" -> "Max Mustermann"; null unless it looks like a person's name (2-4 capitalised words). */
export function personName(raw: string): string | null {
  const name = clean(raw.replace(HONORIFICS, " ").replace(/\([^)]*\)/g, " ").replace(/^[\s,;:.–-]+|[\s,;:.–-]+$/g, ""));
  if (name.length < 5 || name.length > 45 || /[\d@/|:;!?()"„“]/.test(name)) return null;
  const words = name.split(" ");
  if (words.length < 2 || words.length > 4) return null;
  for (const w of words) {
    if (PARTICLES.has(w.toLowerCase())) continue;
    if (!/^\p{Lu}[\p{L}'’.-]*$/u.test(w) || (w.length === 1) || NOT_NAMES.test(w)) return null;
    if (w === w.toUpperCase() && !/^\p{Lu}\.$/u.test(w)) return null; // ALL CAPS words are headings or acronyms; "F." is an initial
  }
  return name;
}

const TITLE_WORDS = /\b(ceo|cto|cfo|coo|cmo|cio|cpo|cro|chief|founder|co-?founder|gründer(?:in)?|mitgründer(?:in)?|owner|inhaber(?:in)?|president|vice president|vp|svp|evp|director|direktor(?:in)?|head of|leiter(?:in)?|leitung|manager(?:in)?|managing|geschäftsführ\w*|geschäftsleitung|vorstand\w*|partner(?:in)?|principal|lead|prokurist(?:in)?|chair(?:man|woman|person)?|general counsel|engineer|developer|designer|consultant|berater(?:in)?|sales|marketing|vertrieb|account executive|architect|analyst|recruiter|officer|praxisinhaber(?:in)?|zahnarzt|zahnärztin|rechtsanwalt|rechtsanwältin|steuerberater(?:in)?|attorney|dentist|physician)\b/i;

/** A job title, not a sentence that happens to mention "marketing". */
export const looksLikeTitle = (s: string): boolean =>
  s.length >= 2 && s.length <= 90 && s.split(" ").length <= 9 && TITLE_WORDS.test(s) && !/[.!?]\s+\p{Lu}|[.!?]$/u.test(s);

const linkedinProfile = (href: string | undefined): string | null =>
  /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+/i.exec(href ?? "")?.[0] ?? null;

function fromJsonLd($: CheerioAPI): Omit<Person, "source_url">[] {
  const people: Omit<Person, "source_url">[] = [];
  const add = (v: unknown, fallbackTitle: string | null) => {
    for (const p of Array.isArray(v) ? v : [v]) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      const name = typeof o.name === "string" ? personName(o.name) : null;
      if (!name) continue;
      const sameAs = (Array.isArray(o.sameAs) ? o.sameAs : [o.sameAs, o.url]).filter((x): x is string => typeof x === "string");
      people.push({
        name,
        title: typeof o.jobTitle === "string" && o.jobTitle.trim() ? clean(o.jobTitle) : fallbackTitle,
        email: typeof o.email === "string" ? o.email.replace(/^mailto:/i, "").toLowerCase() : null,
        linkedin: sameAs.map(linkedinProfile).find(Boolean) ?? null,
      });
    }
  };
  for (const node of jsonLd($)) {
    if (ldTypes(node).includes("Person")) add(node, null);
    add(node.founder ?? node.founders, "Founder");
    add(node.employee ?? node.employees, null);
  }
  return people.filter((p) => p.title); // a bare name without a role is not a lead (blog authors, testimonials)
}

/** Team cards: a name in a heading-like element whose card also states a role. */
function fromCards($: CheerioAPI, homepage: boolean): Omit<Person, "source_url">[] {
  const people: Omit<Person, "source_url">[] = [];
  $('h2, h3, h4, h5, h6, strong, b, figcaption, dt, [class*="name" i], [itemprop="name"]').each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 2 || $el.closest('blockquote, [class*="testimonial" i], [class*="review" i], [class*="quote" i], [class*="referenz" i]').length) return;
    const name = personName($el.text());
    if (!name || people.some((p) => p.name === name)) return;
    // role: explicit itemprop/class first, then the element right after the name, then the next line of the card
    let card = $el.parent();
    if (clean(card.text()) === clean($el.text())) card = card.parent();
    const candidates = [
      card.find('[itemprop="jobTitle"], [class*="title" i], [class*="position" i], [class*="role" i], [class*="job" i]').not(el).first().text(),
      $el.next().text(),
      $el.parent().next().text(),
      clean(card.text()).replace(clean($el.text()), ""), // a card that is just name + role
    ].map(clean);
    const title = candidates.find(looksLikeTitle);
    // "Head of IT at Acme" is a customer quote, not this company's staff
    if (!title || /\s(?:at|bei|@)\s+\p{Lu}/u.test(title)) return;
    // Homepages carry customer quotes ("Head of Privacy · Sanofi"): there, a role followed by something that is not
    // itself a role is taken as another company's name and the person is skipped.
    const tail = title.split(/\s*[·|,–—@]\s*/).pop()!;
    if (homepage && tail !== title && !TITLE_WORDS.test(tail)) return;
    people.push({
      name, title,
      email: (card.find('a[href^="mailto:" i]').first().attr("href") ?? "").slice(7).split("?")[0].toLowerCase() || null,
      linkedin: linkedinProfile(card.find('a[href*="linkedin.com/in/"]').first().attr("href")),
    });
  });
  return people;
}

const IMPRESSUM_ROLE = /(Geschäftsführende[rn]? Gesellschafter(?:in)?|Geschäftsführer(?:in|innen)?|Geschäftsführung|Geschäftsleitung|Inhaber(?:in)?|Vertretungsberechtigte(?:r|n)?(?: Geschäftsführer(?:in)?)?|Vertreten durch(?: den| die)?(?: Geschäftsführer(?:in)?)?|Vorstand(?:svorsitzende[rn]?)?|Managing Directors?|Represented by)\s*:?\s*\n?\s*([^\n]{3,160})/g;
// the role the page states; "Vertreten durch" alone does not say which role, so it stays "authorised representative"
const ROLE_LABEL: [RegExp, string][] = [
  [/gesellschafter/i, "Geschäftsführender Gesellschafter"], [/geschäftsf|geschäftsl/i, "Geschäftsführer"],
  [/inhaber/i, "Inhaber"], [/vorstand/i, "Vorstand"], [/managing/i, "Managing Director"],
  [/vertret/i, "Vertretungsberechtigt"], [/represented/i, "Authorised representative"],
];

/** "Geschäftsführer: Dr. Max Mustermann, Erika Musterfrau" lines of a German legal notice. */
export function fromImpressum(text: string): Omit<Person, "source_url">[] {
  const people: Omit<Person, "source_url">[] = [];
  for (const m of text.matchAll(IMPRESSUM_ROLE)) {
    const title = ROLE_LABEL.find(([re]) => re.test(m[1]))?.[1] ?? m[1];
    // drop a repeated role label, then split "A, B und C"
    const names = m[2].replace(/^(?:(?:der|die|den)\s+)?(?:Geschäftsführer(?:in)?|Inhaber(?:in)?)\s*:?\s*/i, "").split(/,|;|\/|&|\bund\b|\band\b|\bsowie\b/);
    for (const part of names) {
      const name = personName(part);
      if (name && !people.some((p) => p.name === name)) people.push({ name, title, email: null, linkedin: null });
    }
  }
  return people;
}

export function findPeople($: CheerioAPI, text: string, sourceUrl: string, homepage = false): Person[] {
  const people: Person[] = [];
  for (const p of [...fromJsonLd($), ...fromCards($, homepage), ...fromImpressum(text)]) {
    if (!people.some((q) => q.name === p.name)) people.push({ ...p, source_url: sourceUrl });
  }
  return people.slice(0, 25);
}
