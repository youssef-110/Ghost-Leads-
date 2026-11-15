// Emails, phone numbers and social profiles from one HTML page. Only what the page literally publishes.
import type { Socials } from "../shared/types.js";
import type { CheerioAPI } from "./html.js";

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi;
const JUNK_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$|@(example\.|domain\.|email\.com|yourdomain|sentry\.|.*wixpress\.com|schema\.org|w3\.org|mysite\.com|company\.com|test\.)|^[0-9a-f]{24,}@|^(name|email|user|you|your|max\.mustermann|john\.doe|jane\.doe)@/i;

/** Cloudflare email protection: first byte is the XOR key for the rest. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** "name [at] firm [dot] de", "name(at)firm.de", "name {ät} firm.de" -> plain addresses. Bracketed forms only:
 *  plain " at " would turn ordinary sentences into addresses. */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*(?:at|ät|æt|a\s*t)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*(?:dot|punkt)\s*[\])}>]\s*/gi, ".");
}

export function findEmails($: CheerioAPI, text: string): string[] {
  const found: string[] = [];
  const add = (raw: string | null | undefined) => {
    for (const m of (raw ?? "").match(EMAIL) ?? []) {
      const email = m.toLowerCase().replace(/\.+$/, "");
      if (!JUNK_EMAIL.test(email) && !found.includes(email)) found.push(email);
    }
  };
  $('a[href^="mailto:" i]').each((_, a) => {
    try {
      add(decodeURIComponent(($(a).attr("href") ?? "").slice(7).split("?")[0]));
    } catch { /* bad percent-encoding */ }
  });
  $("[data-cfemail]").each((_, el) => add(decodeCfEmail($(el).attr("data-cfemail") ?? "")));
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, a) => add(decodeCfEmail(($(a).attr("href") ?? "").split("#")[1] ?? "")));
  add(deobfuscate(text));
  return dropGlued(found);
}

/** "E-Mail" + "kontakt@firma.de" rendered without a space reads as "e-mailkontakt@firma.de". When the shorter
 *  address was found too, the longer one is that artefact. */
export function dropGlued(emails: string[]): string[] {
  return emails.filter((long) => !emails.some((short) => short !== long && long.endsWith(short) && /^[a-z-]+$/.test(long.slice(0, -short.length))));
}

/** "+4968112345" for international numbers, digits only for national ones (no country is guessed). Null if implausible. */
export function normalizePhone(raw: string): string | null {
  let s = raw.replace(/\(0\)/g, "").replace(/(?:ext|x|durchwahl)\.?\s*\d+$/i, "").replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const plus = s.startsWith("+");
  const digits = s.replace(/\+/g, "");
  if (digits.length < 7 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return null;
  if (!plus && digits.length < 8) return null; // short national numbers are usually not phone numbers
  return (plus ? "+" : "") + digits;
}

// a word label ("Tel", "Telefon:", "Phone") or a single letter that must carry punctuation ("T: ", "P. ")
const LABELLED_PHONE = /(?:^|[\s(>|])(?:(?:tel(?:efon|ephone)?|phone|fon|mobile?|call us)\b\s*\.?\s*:?|[tp]\s*[.:])\s*(\+?[\d(][\d\s()./-]{5,22}\d)/gim;
const INTL_PHONE = /(^|.{0,12})(\+\d{1,3}[\s(.-]?[\d\s()./-]{6,20}\d)/gm;

export function findPhones($: CheerioAPI, text: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const phone = normalizePhone(raw);
    // the same line often appears as +49 681 ... and 0681 ...; the last 7 digits identify it
    if (phone && !found.some((p) => p.slice(-7) === phone.slice(-7))) found.push(phone);
  };
  $('a[href^="tel:" i]').each((_, a) => {
    try {
      add(decodeURIComponent(($(a).attr("href") ?? "").slice(4)));
    } catch { /* bad percent-encoding */ }
  });
  for (const m of text.matchAll(LABELLED_PHONE)) add(m[1]);
  for (const m of text.matchAll(INTL_PHONE)) if (!/fax/i.test(m[1])) add(m[2]);
  return found.slice(0, 5);
}

const SOCIAL: [keyof Socials, RegExp][] = [
  ["linkedin", /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|school|showcase)\/[^/?#]+/i],
  ["twitter", /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent\b|share\b|home\b|search\b|hashtag\b|i\/)[A-Za-z0-9_]{1,15}(?=$|[/?#])/i],
  ["facebook", /^https?:\/\/(?:[a-z-]+\.)?facebook\.com\/(?!sharer|share\b|dialog|tr\b|plugins|policy|privacy|help|login)[^/?#]+(?:\/[^/?#]+)?/i],
  ["instagram", /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/)[A-Za-z0-9_.]+/i],
  ["youtube", /^https?:\/\/(?:www\.)?youtube\.com\/(?:@[^/?#]+|(?:channel|c|user)\/[^/?#]+)/i],
  ["github", /^https?:\/\/(?:www\.)?github\.com\/(?!sponsors\b|features\b|about\b|pricing\b|login\b)[A-Za-z0-9-]+(?=$|[/?#])/i],
  ["tiktok", /^https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/i],
];

/** Every company-profile link per network, in page order. Share/intent links and personal LinkedIn profiles are skipped. */
export function findSocials($: CheerioAPI): Partial<Record<keyof Socials, string[]>> {
  const found: Partial<Record<keyof Socials, string[]>> = {};
  $("a[href]").each((_, a) => {
    const href = ($(a).attr("href") ?? "").trim();
    for (const [network, re] of SOCIAL) {
      const url = re.exec(href)?.[0].replace(/\/$/, "");
      if (url && !found[network]?.includes(url)) (found[network] ??= []).push(url);
    }
  });
  return found;
}

/** The company's own profile among the candidates: the handle that matches the domain name, else the link that
 *  appears on several pages (a site-wide footer). One-off links are usually a team member's own profile. */
export function pickSocials(pages: Partial<Record<keyof Socials, string[]>>[], domain: string): Socials {
  const label = domain.split(".")[0].replace(/[^a-z0-9]/g, "");
  const socials: Socials = {};
  for (const network of SOCIAL.map(([n]) => n)) {
    const counts = new Map<string, number>();
    for (const page of pages) for (const url of page[network] ?? []) counts.set(url, (counts.get(url) ?? 0) + 1);
    const handle = (url: string) => url.split("/").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "");
    const ranked = [...counts].sort((x, y) => y[1] - x[1]);
    const best = ranked.find(([url]) => handle(url).includes(label) || label.includes(handle(url))) ?? ranked.find(([, n]) => n > 1);
    if (best) socials[network] = best[0];
  }
  return socials;
}
