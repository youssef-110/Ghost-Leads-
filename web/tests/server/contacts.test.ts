import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCfEmail, deobfuscate, dropGlued, findEmails, findPhones, findSocials, normalizePhone, pickSocials } from "../../server/contacts.js";
import { parseHtml, visibleText } from "../../server/html.js";

const page = (html: string) => {
  const $ = parseHtml(html);
  return { $, text: visibleText($) };
};

/** Cloudflare's scheme, to build a fixture: key byte, then every character XOR key, as hex. */
const cfEncode = (email: string, key = 0x5a) =>
  [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, "0")).join("");

test("emails from mailto links, visible text, obfuscation and Cloudflare protection", () => {
  const { $, text } = page(`
    <html><head><script>var x = "tracking@script-only.com";</script><style>.a{content:"css@style-only.com"}</style></head><body>
      <a href="mailto:Anna.Schmidt@Firma.de?subject=Hallo">Schreiben Sie uns</a>
      <a href="mailto:info%40firma.de">Mail</a>
      <p>Vertrieb: vertrieb [at] firma [dot] de oder max.muster(at)firma.de</p>
      <p>Presse: presse {ät} firma.de. Bewerbungen an jobs@firma.de.</p>
      <a href="/cdn-cgi/l/email-protection#${cfEncode("chef@firma.de")}">[email&#160;protected]</a>
      <span class="__cf_email__" data-cfemail="${cfEncode("lager@firma.de")}">[email protected]</span>
      <img src="/img/logo@2x.png"> <p>Platzhalter: name@example.com, you@yourdomain.com, 0123456789abcdef0123456789abcdef@sentry.io</p>
    </body></html>`);
  assert.deepEqual(findEmails($, text).sort(), [
    "anna.schmidt@firma.de", "chef@firma.de", "info@firma.de", "jobs@firma.de", "lager@firma.de", "max.muster@firma.de",
    "presse@firma.de", "vertrieb@firma.de",
  ]);
});

test("a label rendered flush against an address is not a second address", () => {
  const { $, text } = page('<p><span>E-Mail</span><a href="mailto:kontakt@firma.de">kontakt@firma.de</a></p>');
  assert.match(text, /E-Mailkontakt@firma\.de/); // the artefact exists in the text
  assert.deepEqual(findEmails($, text), ["kontakt@firma.de"]);
  assert.deepEqual(dropGlued(["e-mailinfo@a.de", "info@a.de", "anna.info@a.de"]), ["info@a.de", "anna.info@a.de"]);
});

test("decodeCfEmail and deobfuscate", () => {
  assert.equal(decodeCfEmail(cfEncode("a.b@c.de", 0x11)), "a.b@c.de");
  assert.equal(decodeCfEmail("zz"), null);
  assert.equal(deobfuscate("hans [at] firma [dot] de"), "hans@firma.de");
  assert.equal(deobfuscate("look at this dot here"), "look at this dot here"); // plain words are left alone
});

test("normalizePhone keeps international numbers, never guesses a country, rejects junk", () => {
  assert.equal(normalizePhone("+49 (0) 681 / 12 34-56"), "+49681123456");
  assert.equal(normalizePhone("0049 681 123456"), "+49681123456");
  assert.equal(normalizePhone("(415) 555-2671"), "4155552671");
  assert.equal(normalizePhone("0681 123456"), "0681123456");
  assert.equal(normalizePhone("+1 415 555 2671 ext. 12"), "+14155552671");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("1234567"), null); // seven digits without a country code: too likely not a phone
  assert.equal(normalizePhone("0000000000"), null);
  assert.equal(normalizePhone("+1234567890123456789"), null);
});

test("phones from tel: links, labelled text and international format; fax and other numbers are skipped", () => {
  const { $, text } = page(`
    <a href="tel:+49-681-9876540">Anrufen</a>
    <p>Telefon: 0681 / 98 76 54-0</p>
    <p>Tel. 030 1234567</p>
    <p>Fax: +49 681 9876549</p>
    <p>Mobil: +49 171 2345678</p>
    <p>HRB 12345678, USt-IdNr. DE123456789, 66111 Saarbrücken, gegründet 1998-2004, Bestellnr 20240115001</p>
    <p>Call us: (415) 555-2671</p>`);
  assert.deepEqual(findPhones($, text), ["+496819876540", "0301234567", "+491712345678", "4155552671"]);
});

test("social links: company pages only, no share or intent links", () => {
  const { $ } = page(`
    <a href="https://www.linkedin.com/company/acme-gmbh/">LinkedIn</a>
    <a href="https://www.linkedin.com/in/max-mustermann">Max</a>
    <a href="https://www.linkedin.com/shareArticle?url=x">Share</a>
    <a href="https://twitter.com/intent/tweet?text=hi">Tweet</a>
    <a href="https://x.com/acme">X</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
    <a href="https://www.facebook.com/acme.gmbh">FB</a>
    <a href="https://www.instagram.com/p/Cabc123/">Post</a>
    <a href="https://www.instagram.com/acme_gmbh/">IG</a>
    <a href="https://www.youtube.com/watch?v=abc">Video</a>
    <a href="https://www.youtube.com/@acme">YT</a>
    <a href="https://github.com/acme">GH</a>
    <a href="https://www.tiktok.com/@acme">TT</a>`);
  assert.deepEqual(findSocials($), {
    linkedin: ["https://www.linkedin.com/company/acme-gmbh"], twitter: ["https://x.com/acme"],
    facebook: ["https://www.facebook.com/acme.gmbh"], instagram: ["https://www.instagram.com/acme_gmbh"],
    youtube: ["https://www.youtube.com/@acme"], github: ["https://github.com/acme"], tiktok: ["https://www.tiktok.com/@acme"],
  });
});

test("pickSocials prefers the handle matching the domain, then links repeated across pages", () => {
  const home = { twitter: ["https://x.com/founder_jane", "https://x.com/acmehq"], github: ["https://github.com/janedoe"], youtube: ["https://www.youtube.com/@brandtv"] };
  const about = { twitter: ["https://x.com/founder_jane"], youtube: ["https://www.youtube.com/@brandtv"] };
  assert.deepEqual(pickSocials([home, about], "acme.com"), {
    twitter: "https://x.com/acmehq",               // matches the domain although it appears once
    youtube: "https://www.youtube.com/@brandtv",   // site-wide link
    // github: a one-off personal profile is not the company's
  });
});

test("visibleText keeps label and value on one line and drops scripts", () => {
  const { text } = page("<div><b>Geschäftsführer:</b> Max <i>Mustermann</i></div><script>alert(1)</script><p>Zeile zwei<br>Zeile drei</p>");
  assert.equal(text, "Geschäftsführer: Max Mustermann\nZeile zwei\nZeile drei");
});
