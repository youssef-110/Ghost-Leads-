// Honesty rules for the public site: nothing invented is presented as real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const siteDir = new URL('../src/site/', import.meta.url);
// Every public page and the modules they share. New files under src/site are picked up without touching this list.
const pages = {
  'Landing.tsx': read('../src/Landing.tsx'),
  'index.html': read('../index.html'),
  ...Object.fromEntries(readdirSync(siteDir).filter((f) => /\.tsx?$/.test(f)).map((f) => [f, read(`../src/site/${f}`)])),
};
const LEGAL = ['Privacy.tsx', 'Terms.tsx'];
const each = (check) => { for (const [name, text] of Object.entries(pages)) check(text, name); };
const LABEL = 'Illustrative example · not a real lead';

test('every product mockup carries the illustrative label', () => {
  let figures = 0;
  each((text, name) => {
    const n = text.split('<figure').length - 1;
    figures += n;
    assert.equal(text.split(LABEL).length - 1, n, `${name}: each <figure> mockup needs "${LABEL}"`);
  });
  assert.ok(figures >= 4, 'the landing page mockups are still marked up as <figure>');
});

test('sample companies use the reserved .example domain', () => {
  let seen = 0;
  each((text, name) => {
    // domain-shaped string literals, except GSAP ease names such as "power3.out"
    for (const [, domain] of text.matchAll(/(?<!ease(?:: | = ))"([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})"/g)) {
      seen++;
      assert.match(domain, /\.example$/, `${name}: "${domain}" looks like a real domain in sample data`);
    }
    for (const [email] of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
      assert.match(email, /\.example$/, `${name}: "${email}" looks like a real address`);
    }
  });
  assert.ok(seen >= 20, 'sample rows were found and checked');
});

test('no social proof that does not exist', () => {
  each((text, name) => {
    assert.doesNotMatch(text, /trusted by|loved by|used by \d|join \d|customers? (?:say|love)|as seen (?:in|on)|case stud/i, `${name}: social proof claim`);
    assert.doesNotMatch(text, /<blockquote|testimonial|className="[^"]*\b(?:logos|logo-(?:wall|strip|grid|cloud|row)|quote|review|stars?|rating)\b/i, `${name}: testimonial or logo-wall markup`);
    assert.doesNotMatch(text, /\d[\d,.]*\s*(?:k|m|\+)?\s+(?:users|customers|teams|companies trust)/i, `${name}: user count`);
  });
});

test('no accuracy, ranking or deliverability claims', () => {
  each((text, name) => {
    assert.doesNotMatch(text, /\baccura(?:cy|te)\b/i, `${name}: accuracy claim`);
    assert.doesNotMatch(text, /\d\s?%\s*(?:of|more|faster|higher|match|coverage|valid|verified|open|reply|response|increase|lift)|\d\s?x\s+(?:more|faster|the)/i, `${name}: numeric performance claim`);
    assert.doesNotMatch(text, /verified (?:e-?mails?|contacts?|leads?)|guaranteed|deliverab/i, `${name}: claims more than an MX check`);
    assert.doesNotMatch(text, /#1\b|\bnumber one\b|\bthe best\b|\bbest[- ]in[- ]class\b|\bworld[- ]class\b|\bleading\b/i, `${name}: ranking claim`);
  });
  assert.match(pages['Home.tsx'], /not a promise that someone reads the inbox/, 'the email status is explained honestly');
});

test('plans show no invented prices and paid plans are a contact link', () => {
  each((text, name) => {
    for (const [price] of text.matchAll(/[€$£]\s?\d[\d.,]*/g)) assert.equal(price, '€0', `${name}: invented price ${price}`);
  });
  const chrome = pages['chrome.tsx'];
  assert.match(chrome, /price: "€0"/);
  assert.equal(chrome.split('price: "Custom"').length - 1, 2, 'Pro and Team are priced "Custom"');
  assert.match(chrome, /\/contact\?topic=/, 'paid plans link to the contact form, not a checkout');
  assert.doesNotMatch(chrome, /mailto:/, 'no inbox address is published');
  assert.doesNotMatch(chrome, /checkout|stripe|buy now|subscribe/i);
});

test('plan limits are computed from what the product enforces, not typed by hand', () => {
  const plans = pages['plans.ts'];
  assert.match(plans, /import \{ FREE_LIMITS \} from "\.\.\/\.\.\/shared\/types"/, 'the site reads the same limits the server enforces');
  const kinds = [...read('../shared/types.ts').match(/FREE_LIMITS[^=]*=\s*\{([^}]*)\}/)[1].matchAll(/(\w+):\s*\d+/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 5, 'the enforced limits were found');
  for (const kind of kinds) assert.match(plans, new RegExp(`\\["${kind}", "[^"]+"\\]`), `the site names the "${kind}" limit`);

  // Paid plans multiply the free limits by the same factors the app uses.
  const [, pro, team] = read('../src/app/logic.ts').match(/"pro" \? (\d+) : plan === "team" \? (\d+)/);
  assert.match(plans, new RegExp(`Free: 1, Pro: ${pro}, Team: ${team}\\b`), 'plan factors match the app');

  for (const name of ['chrome.tsx', 'Pricing.tsx', 'Home.tsx']) {
    assert.match(pages[name], /dailyLimits\(/, `${name} takes its numbers from plans.ts`);
    assert.doesNotMatch(pages[name], /\d[\d,]*\s+(?:searches|enrichments|page scrapes|AI drafts|email checks)/, `${name}: a limit typed by hand`);
    assert.doesNotMatch(pages[name], /higher (?:daily )?limits|highest/i, `${name}: a vague limit instead of the number`);
  }
});

test('legal pages are marked as drafts and invent no company, address or jurisdiction', () => {
  const main = read('../src/main.tsx');
  for (const name of LEGAL) {
    const text = pages[name];
    const path = `/${name.replace('.tsx', '').toLowerCase()}`;
    assert.match(main, new RegExp(`path="${path}"`), `${path} is routed`);
    assert.match(pages['chrome.tsx'], new RegExp(`<Link to="${path}">`), `${path} is linked from the footer`);
    assert.match(text, /<DraftNotice>/, `${name}: draft banner`);
    for (const placeholder of ['legal entity name', 'registered address', 'effective date']) {
      assert.match(text, new RegExp(`<Ph>${placeholder}</Ph>`), `${name}: "${placeholder}" stays a marked placeholder`);
    }
    assert.doesNotMatch(text, /\b(?:GmbH|Ltd|LLC|Inc|Corp|B\.V|S\.A|UG|AG)\b/, `${name}: an invented legal entity`);
    assert.doesNotMatch(text, /governed by (?!<Ph>)|laws? of (?!<Ph>)|courts of (?!<Ph>)/i, `${name}: an invented jurisdiction`);
  }
  assert.match(pages['chrome.tsx'], /className="notice"[^>]*><b>Draft<\/b>/, 'the banner says Draft');
  assert.match(pages['Terms.tsx'], /have counsel review before launch/);
  assert.match(pages['Privacy.tsx'], /owner must review it/);
  assert.match(pages['Terms.tsx'], /<Ph>governing law and courts<\/Ph>/);
  assert.match(pages['Privacy.tsx'], /how to ask for data to be removed/i);
});

test('search and sharing basics state only what is true', () => {
  const html = pages['index.html'];
  const origin = new URL(html.match(/<link rel="canonical" href="([^"]+)"/)[1]).origin;
  assert.equal(html.split(origin).length - 1, 4, 'the domain is written once in a comment and in three adjacent tags');
  assert.match(html, new RegExp(`og:image" content="${origin}/og\\.png"`));
  for (const file of ['og.png', 'apple-touch-icon.png', 'favicon.svg']) assert.ok(existsSync(new URL(`../public/${file}`, import.meta.url)), `public/${file}`);

  const robots = read('../public/robots.txt');
  assert.match(robots, /^User-agent: \*\nAllow: \/\nDisallow: \/app\n/);
  assert.match(robots, new RegExp(`Sitemap: ${origin}/sitemap\\.xml`));
  const locs = [...read('../public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ['/', '/pricing', '/bot', '/contact'].map((path) => origin + path));

  // Each page names its own address, title and description; the home page keeps the ones in index.html.
  assert.match(pages['Home.tsx'], /<SitePage path="\/">/);
  for (const [name, path] of [['Pricing.tsx', '/pricing'], ['Bot.tsx', '/bot'], ['Privacy.tsx', '/privacy'], ['Terms.tsx', '/terms'], ['Contact.tsx', '/contact']]) {
    assert.match(pages[name], new RegExp(`<SitePage path="${path}" title="[^"]+" description="[^"]{50,}">`), `${name}: own title and description`);
  }

  const home = pages['Home.tsx'];
  assert.match(home, /"@type": "SoftwareApplication"/);
  assert.match(home, /price: "0", priceCurrency: "EUR"/, 'the only offer in the structured data is the free plan');
  assert.equal(home.split('"@type": "Offer"').length - 1, 1);
  assert.doesNotMatch(home, /aggregateRating|ratingValue|reviewCount|"Review"|award/i, 'no ratings or reviews in the structured data');
});

test('the crawler page names the user-agent and the opt-out', () => {
  const bot = pages['Bot.tsx'];
  assert.match(bot, /GhostLeadsBot\/1\.0/);
  assert.match(bot, /User-agent: GhostLeadsBot\\nDisallow: \//);
  assert.match(read('../src/main.tsx'), /path="\/bot"/);
});
