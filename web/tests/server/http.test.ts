// The endpoint wrapper: auth, validation order, metering and the error contract. Supabase is a mocked fetch.
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import discover from "../../api/discover.js";
import draft from "../../api/draft.js";
import health from "../../api/health.js";
import verify from "../../api/verify.js";
import { ApiFail, endpoint } from "../../server/http.js";

const WS = "0b9f6a52-3c1d-4e8a-9f27-5d3c8a1b2e4f";

async function call(handler: (req: VercelRequest, res: VercelResponse) => unknown, body: unknown, opts: { token?: string | null; method?: string } = {}) {
  const out = { status: 0, body: null as unknown };
  const res = { status(code: number) { out.status = code; return res; }, json(data: unknown) { out.body = data; return res; } };
  const headers = opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? "user-token"}` };
  await handler({ method: opts.method ?? "POST", headers, body } as unknown as VercelRequest, res as unknown as VercelResponse);
  return out;
}

/** Replaces global fetch with a Supabase gl_use() stub and records what it was asked. */
function supabase(reply: { status: number; body: unknown } = { status: 200, body: { used: 1, limit: 40 } }) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  return calls;
}

afterEach(() => mock.restoreAll());
const ok = endpoint("discover", () => ({ run: async () => ({ fine: true }) }));

test("a valid call is metered with the caller's own token, then run", async () => {
  const calls = supabase();
  assert.deepEqual(await call(ok, { ws: WS }), { status: 200, body: { fine: true } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/gl_use$/);
  assert.equal(calls[0].headers.authorization, "Bearer user-token");
  assert.ok(calls[0].headers.apikey);
  assert.deepEqual(calls[0].body, { p_ws: WS, p_kind: "discover", p_n: 1 });
});

test("requests are rejected before metering: no token, wrong method, bad body, bad workspace id", async () => {
  const calls = supabase();
  assert.deepEqual(await call(ok, { ws: WS }, { token: null }), { status: 401, body: { error: "Missing access token", code: "unauthorized" } });
  assert.equal((await call(ok, { ws: WS }, { method: "GET" })).status, 400);
  assert.equal((await call(ok, "not json")).status, 400);
  assert.equal((await call(ok, [1, 2])).status, 400);
  assert.equal((await call(ok, {})).status, 400);
  assert.equal((await call(ok, { ws: "1; drop table" })).status, 400);
  assert.equal(calls.length, 0);
});

test("gl_use errors map to the contract: 42501 -> 401, quota -> 429, expired token -> 401, outage -> 502", async () => {
  let ran = false;
  const handler = endpoint("enrich", () => ({ run: async () => { ran = true; return {}; } }));
  const outcome = async (status: number, body: unknown) => {
    supabase({ status, body });
    const out = await call(handler, { ws: WS });
    mock.restoreAll();
    return [out.status, (out.body as { code: string }).code];
  };
  assert.deepEqual(await outcome(403, { code: "42501", message: "not a member of this workspace" }), [401, "unauthorized"]);
  assert.deepEqual(await outcome(401, { code: "PGRST301", message: "JWT expired" }), [401, "unauthorized"]);
  assert.deepEqual(await outcome(400, { code: "P0001", message: "quota" }), [429, "quota"]);
  assert.deepEqual(await outcome(400, { code: "22023", message: "bad amount" }), [400, "bad_request"]);
  assert.deepEqual(await outcome(500, { message: "boom" }), [502, "upstream"]);
  mock.method(globalThis, "fetch", async () => { throw new Error("network down"); });
  assert.equal((await call(handler, { ws: WS })).status, 502);
  assert.equal(ran, false, "no work is done unless metering succeeded");
});

test("errors thrown by the work use the documented status codes; unknown errors do not leak details", async () => {
  supabase();
  const failing = (e: unknown) => endpoint("extract", () => ({ run: async () => { throw e; } }));
  const statuses = { bad_request: 400, unauthorized: 401, blocked: 422, quota: 429, upstream: 502, not_configured: 503 } as const;
  for (const [code, status] of Object.entries(statuses)) {
    assert.deepEqual(await call(failing(new ApiFail(code as keyof typeof statuses, "why")), { ws: WS }), { status, body: { error: "why", code } });
  }
  mock.method(console, "error", () => {});
  assert.deepEqual(await call(failing(new TypeError("secret internals at /var/task/x.js")), { ws: WS }), { status: 502, body: { error: "Unexpected server error", code: "upstream" } });
});

test("discover validates its parameters before any quota is spent", async () => {
  const calls = supabase();
  const code = async (body: object) => ((await call(discover, { ws: WS, ...body })).body as { code: string }).code;
  assert.equal(await code({ source: "nope" }), "bad_request");
  assert.equal(await code({ source: "maps", query: "dentist" }), "bad_request"); // location missing
  assert.equal(await code({ source: "web", query: "" }), "bad_request");
  assert.equal(await code({ source: "web", query: "x", limit: -1 }), "bad_request");
  assert.equal(await code({ source: "directory", url: "ftp://files.test/list" }), "bad_request");
  assert.equal(await code({ source: "directory", url: "http://169.254.169.254/latest/meta-data/" }), "blocked");
  assert.equal(await code({ source: "directory", url: "http://localhost:3000/members" }), "blocked");
  assert.equal(calls.length, 0);
});

test("verify meters one unit per address and caps a call at 50", async () => {
  const calls = supabase();
  const out = await call(verify, { ws: WS, emails: ["not-an-email", "also bad"] });
  assert.equal(out.status, 200);
  assert.deepEqual((out.body as { results: { status: string }[] }).results.map((r) => r.status), ["invalid", "invalid"]);
  assert.equal((calls[0].body as { p_n: number }).p_n, 2);
  assert.equal((await call(verify, { ws: WS, emails: Array(51).fill("a@b.de") })).status, 400);
  assert.equal((await call(verify, { ws: WS, emails: [] })).status, 400);
  assert.equal((await call(verify, { ws: WS, emails: "a@b.de" })).status, 400);
  assert.equal(calls.length, 1);
});

test("draft answers 503 without an OpenAI key, before metering", async () => {
  const calls = supabase();
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const out = await call(draft, { ws: WS, channel: "email", offer: "We sell widgets", prospect: { company_name: "Acme" } });
    assert.equal(out.status, 503);
    assert.equal((out.body as { code: string }).code, "not_configured");
    assert.equal(calls.length, 0);
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});

test("health needs no token and reports which providers are configured", async () => {
  const saved = { ai: process.env.OPENAI_API_KEY, serper: process.env.SERPER_API_KEY };
  delete process.env.OPENAI_API_KEY;
  process.env.SERPER_API_KEY = "test-key";
  try {
    const out = await call(health, undefined, { token: null, method: "GET" });
    assert.equal(out.status, 200);
    assert.deepEqual({ ...(out.body as object), version: "x" }, { ai: false, search: "serper", version: "x" });
  } finally {
    if (saved.ai !== undefined) process.env.OPENAI_API_KEY = saved.ai;
    if (saved.serper === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = saved.serper;
  }
});
