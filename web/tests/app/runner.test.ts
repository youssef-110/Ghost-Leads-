import assert from "node:assert/strict";
import { test } from "node:test";
import type { Enrichment, Prospect } from "../../shared/types";
import { canRetry, needsEnrich, runEnrichment, type EnrichRow } from "../../src/app/logic";

const row = (id: number, domain: string | null = `c${id}.com`): EnrichRow =>
  ({ id, domain, company_name: domain ?? `Company ${id}`, website: null, phone: null, address: null, description: null });
const enrichment = (domain: string): Enrichment => ({
  domain, website: `https://${domain}`, company_name: null, description: null, language: null, emails: [], phones: [],
  socials: {}, people: [], tech: [], address: null, pages_crawled: 1, score: 50, score_reasons: [],
});
const fail = (code: string, message = code) => Object.assign(new Error(message), { code });

/** Records every save so tests can assert the status trail of each row. */
function recorder() {
  const trail = new Map<number, string[]>();
  const save = async (id: number, patch: Partial<Prospect>) => {
    trail.set(id, [...(trail.get(id) ?? []), patch.status ?? "?"]);
  };
  return { trail, save };
}

test("enriches every row with a domain, skips the rest, reports progress", async () => {
  const { trail, save } = recorder();
  const seen: number[] = [];
  const r = await runEnrichment([row(1), row(2, null), row(3)], {
    enrich: async (x) => enrichment(x.domain), save, onProgress: (p) => seen.push(p.done),
  });
  assert.deepEqual(r, { total: 2, done: 2, failed: 0, skipped: 1, stopped: null });
  assert.deepEqual(trail.get(1), ["enriching", "enriched"]);
  assert.equal(trail.has(2), false, "a row without a website is left untouched");
  assert.equal(seen.at(-1), 2);
  assert.equal(seen[0], 0);
});

test("never runs more than `concurrency` requests at once", async () => {
  let live = 0, peak = 0;
  const r = await runEnrichment(Array.from({ length: 10 }, (_, i) => row(i + 1)), {
    concurrency: 3, save: async () => {},
    enrich: async (x) => {
      peak = Math.max(peak, ++live);
      await new Promise((res) => setTimeout(res, 5));
      live--;
      return enrichment(x.domain);
    },
  });
  assert.equal(peak, 3);
  assert.equal(r.done, 10);
});

test("a failing site marks its row failed with the reason and the run continues", async () => {
  const saved: Partial<Prospect>[] = [];
  const r = await runEnrichment([row(1), row(2)], {
    concurrency: 1,
    save: async (_id, p) => { saved.push(p); },
    enrich: async (x) => { if (x.id === 1) throw fail("blocked", "That site does not allow automated access."); return enrichment(x.domain); },
  });
  assert.deepEqual([r.done, r.failed, r.stopped], [1, 1, null]);
  assert.deepEqual(saved[1], { status: "failed", error: "That site does not allow automated access." });
});

for (const code of ["quota", "unauthorized", "unavailable", "network"] as const) {
  test(`${code} stops the run and puts the row back to new`, async () => {
    const { trail, save } = recorder();
    let calls = 0;
    const r = await runEnrichment([row(1), row(2), row(3), row(4)], {
      concurrency: 1, save,
      enrich: async (x) => { if (++calls === 2) throw fail(code); return enrichment(x.domain); },
    });
    assert.deepEqual([r.done, r.failed, r.stopped], [1, 0, code]);
    assert.deepEqual(trail.get(2), ["enriching", "new"]);
    assert.equal(trail.has(3), false);
    assert.equal(calls, 2);
  });
}

test("a fatal stop puts a re-enriched or retried row back to the status it had", async () => {
  const saved: Partial<Prospect>[] = [];
  const quota = { concurrency: 1, save: async (_id: number, p: Partial<Prospect>) => { saved.push(p); }, enrich: async () => { throw fail("quota"); } };
  await runEnrichment([{ ...row(1), status: "enriched" }], quota);
  assert.deepEqual(saved.at(-1), { status: "enriched", error: null });
  await runEnrichment([{ ...row(2), status: "failed", error: "robots.txt" }], quota);
  assert.deepEqual(saved.at(-1), { status: "failed", error: "robots.txt" });
  await runEnrichment([{ ...row(3), status: "enriching" }], quota);
  assert.deepEqual(saved.at(-1), { status: "new", error: null });
});

test("user stop: in-flight rows finish, no new ones start", async () => {
  const { trail, save } = recorder();
  let stop = false;
  const r = await runEnrichment([row(1), row(2), row(3)], {
    concurrency: 1, save, shouldStop: () => stop,
    enrich: async (x) => { stop = true; return enrichment(x.domain); },
  });
  assert.deepEqual([r.done, r.stopped], [1, "user"]);
  assert.deepEqual(trail.get(1), ["enriching", "enriched"]);
  assert.equal(trail.has(2), false);
});

test("a save that fails counts the row as failed instead of hanging the run", async () => {
  const r = await runEnrichment([row(1), row(2)], {
    concurrency: 1, enrich: async (x) => enrichment(x.domain),
    save: async (id) => { if (id === 1) throw new Error("offline"); },
  });
  assert.deepEqual([r.done, r.failed], [1, 1]);
});

test("empty input resolves immediately", async () => {
  assert.deepEqual(await runEnrichment([], { enrich: async () => enrichment("x.com"), save: async () => {} }),
    { total: 0, done: 0, failed: 0, skipped: 0, stopped: null });
});

test("needsEnrich: new rows and ones a closed tab left in enriching, never failed ones", () => {
  assert.equal(needsEnrich({ domain: "a.com", status: "new" }), true);
  assert.equal(needsEnrich({ domain: "a.com", status: "enriching" }), true);
  assert.equal(needsEnrich({ domain: "a.com", status: "failed" }), false, "a retry costs quota: it has to be asked for");
  assert.equal(needsEnrich({ domain: "a.com", status: "enriched" }), false);
  assert.equal(needsEnrich({ domain: null, status: "new" }), false);
});

test("canRetry: only failed rows that have a website", () => {
  assert.equal(canRetry({ domain: "a.com", status: "failed" }), true);
  assert.equal(canRetry({ domain: null, status: "failed" }), false);
  for (const status of ["new", "enriching", "enriched"] as const) assert.equal(canRetry({ domain: "a.com", status }), false, status);
});

test("a re-run passes what the row already has, so the patch merges instead of replacing", async () => {
  const saved: Partial<Prospect>[] = [];
  const known = { email: "jo@c1.com", kind: "personal" as const, status: "valid" as const, reason: null, source_url: null };
  await runEnrichment([{ ...row(1), emails: [known], tech: ["Shopify"] }], {
    enrich: async (x) => ({ ...enrichment(x.domain), tech: ["Stripe"] }), save: async (_id, p) => { saved.push(p); },
  });
  assert.deepEqual(saved[1].emails, [known]);
  assert.deepEqual(saved[1].tech, ["Shopify", "Stripe"]);
});
