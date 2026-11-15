// Email classification and checking. No SMTP probing (port 25 is closed on Vercel), so a mailbox is never called
// "verified": the strongest claim is "published by the company on a domain that accepts mail".
import { Resolver } from "node:dns/promises";
import type { FoundEmail } from "../shared/types.js";

const SYNTAX = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/i;
export const validSyntax = (email: string): boolean => email.length <= 254 && email.indexOf("@") <= 64 && SYNTAX.test(email);

const ROLE = new Set([
  "info", "contact", "kontakt", "hello", "hallo", "hi", "hey", "mail", "email", "post", "office", "buero", "team", "admin",
  "sales", "vertrieb", "support", "help", "hilfe", "service", "kundenservice", "customerservice", "care", "billing",
  "accounts", "accounting", "buchhaltung", "finance", "rechnung", "invoice", "jobs", "job", "career", "careers", "karriere",
  "bewerbung", "hr", "recruiting", "personal", "press", "presse", "media", "pr", "marketing", "newsletter", "news",
  "privacy", "datenschutz", "legal", "recht", "compliance", "security", "abuse", "postmaster", "webmaster", "hostmaster",
  "noreply", "no-reply", "donotreply", "order", "orders", "bestellung", "shop", "store", "booking", "reservierung",
  "reservations", "anfrage", "anfragen", "enquiries", "inquiries", "inquiry", "feedback", "empfang", "reception", "zentrale",
  "praxis", "kanzlei", "sekretariat", "partner", "partners", "events", "welcome", "general", "home", "web", "it", "dev",
  "tech", "techsupport", "management", "verwaltung", "einkauf", "purchasing", "export", "import", "impressum",
]);

/** Shared inbox or a person's own address. Conservative: an address only counts as personal when it is shaped like
 *  a name (first.last, f.last) or matches a person named on the site (`names`). berlin@ and solutions@ are shared
 *  inboxes, and so is an unexplained single word such as jo@. */
export function emailKind(email: string, names: string[] = []): "personal" | "role" {
  const local = email.split("@")[0].toLowerCase().split("+")[0];
  const tokens = local.split(/[._-]/);
  if (ROLE.has(local) || tokens.some((t) => ROLE.has(t))) return "role";
  if (names.some((n) => patternOf(n, local))) return "personal";
  return tokens.length >= 2 && tokens.every((t) => /^[a-z]+$/.test(t)) ? "personal" : "role";
}

export type Mx = "ok" | "none" | "unknown";
const resolver = new Resolver({ timeout: 3000, tries: 2 });
const mxCache = new Map<string, Promise<Mx>>();

/** Whether the domain publishes a usable MX record. A null MX (".") means "accepts no mail" (RFC 7505). */
export function mxStatus(domain: string): Promise<Mx> {
  const key = domain.toLowerCase();
  let hit = mxCache.get(key);
  if (!hit) {
    hit = resolver.resolveMx(key).then(
      (records) => (records.some((r) => r.exchange && r.exchange !== ".") ? "ok" : "none"),
      (e: NodeJS.ErrnoException) => (e.code === "ENOTFOUND" || e.code === "ENODATA" ? "none" : "unknown"),
    );
    if (mxCache.size > 2000) mxCache.clear();
    mxCache.set(key, hit);
    void hit.then((r) => r === "unknown" && mxCache.delete(key)); // do not remember lookup failures
  }
  return hit;
}

/** Status for one address. `sourceUrl` is the page that published it; null when we only know the address itself. */
export async function checkEmail(raw: string, sourceUrl: string | null, names: string[] = []): Promise<FoundEmail> {
  const email = raw.trim().toLowerCase();
  const base = { email, kind: emailKind(email, names), source_url: sourceUrl };
  if (!validSyntax(email)) return { ...base, status: "invalid", reason: "not a valid email address" };
  const mx = await mxStatus(email.split("@")[1]);
  if (mx === "none") return { ...base, status: "invalid", reason: "no MX record: this domain cannot receive mail" };
  if (mx === "unknown") return { ...base, status: "unknown", reason: "could not look up the domain's mail server" };
  return sourceUrl
    ? { ...base, status: "valid", reason: "published by the company; domain accepts mail (mailbox not SMTP-tested)" }
    : { ...base, status: "risky", reason: "domain accepts mail, but the mailbox itself could not be tested (no SMTP check)" };
}

const ascii = (s: string): string => s.toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[^a-z]/g, "");

const PATTERNS: Record<string, (f: string, l: string) => string> = {
  "first.last": (f, l) => `${f}.${l}`,
  "firstlast": (f, l) => f + l,
  "f.last": (f, l) => `${f[0]}.${l}`,
  "flast": (f, l) => f[0] + l,
  "first": (f) => f,
  "last": (_, l) => l,
  "first_last": (f, l) => `${f}_${l}`,
  "first-last": (f, l) => `${f}-${l}`,
  "last.first": (f, l) => `${l}.${f}`,
  "firstl": (f, l) => f + l[0],
};

function nameParts(name: string): [string, string] | null {
  const words = name.split(/\s+/).map(ascii).filter(Boolean);
  return words.length >= 2 ? [words[0], words[words.length - 1]] : null;
}

/** Which naming pattern turns `name` into the local part `local` ("first.last", "flast"...), if any. */
export function patternOf(name: string, local: string): string | undefined {
  const parts = nameParts(name);
  return parts ? Object.keys(PATTERNS).find((p) => PATTERNS[p](...parts) === local) : undefined;
}

/** The address pattern a company uses, read off a published address that matches a known person. */
export function detectPattern(names: string[], emails: string[], domain: string): { pattern: string; example: string } | null {
  for (const email of emails) {
    const [local, host] = email.split("@");
    if (host !== domain) continue;
    for (const name of names) {
      const pattern = patternOf(name, local);
      if (pattern) return { pattern, example: email };
    }
  }
  return null;
}

export function guessEmail(name: string, domain: string, pattern = "first.last"): string | null {
  const parts = nameParts(name);
  return parts ? `${PATTERNS[pattern](...parts)}@${domain}` : null;
}
