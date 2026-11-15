// The SSRF guard and fetch limits. No test touches the network: the https client is replaced by canned responses,
// and the body cap is exercised against a local server through readBody (the guard itself refuses 127.0.0.1).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, mock, test } from "node:test";
import zlib from "node:zlib";
import { USER_AGENT, checkUrl, guardedLookup, isBlockedAddress, readBody, safeFetch } from "../../server/fetch.js";
import { HTML, cannedHttps, type Canned } from "./helpers.js";

test("isBlockedAddress refuses private, loopback, link-local, CGNAT, multicast and metadata addresses", () => {
  const blocked = [
    "127.0.0.1", "127.8.9.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.10",
    "::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "not-an-ip",
  ];
  for (const ip of blocked) assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4001:81b::200e"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("checkUrl accepts only plain http(s) URLs on public hosts", () => {
  assert.equal(checkUrl("https://example.com/a?b=1#frag").href, "https://example.com/a?b=1");
  const code = (url: string) => { try { checkUrl(url); return "ok"; } catch (e) { return (e as { code: string }).code; } };
  assert.equal(code("ftp://example.com/"), "bad_request");
  assert.equal(code("file:///etc/passwd"), "bad_request");
  assert.equal(code("javascript:alert(1)"), "bad_request");
  assert.equal(code("not a url"), "bad_request");
  assert.equal(code("https://user:pw@example.com/"), "bad_request");
  for (const url of [
    "http://127.0.0.1/", "http://localhost/", "http://2130706433/", "http://0x7f.1/", "http://127.1/", "http://[::1]/",
    "http://[::ffff:10.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "http://intranet/", "http://db.internal/",
    "http://printer.local/", "http://example.com:8080/", "https://example.com:22/",
  ]) assert.equal(code(url), "blocked", url);
});

test("the connect-time lookup refuses names that resolve to a blocked address", async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup("localhost", {}, (e) => resolve(e)));
  assert.equal(err?.code, "EBLOCKED");
});

test("the User-Agent names the bot and its opt-out page", () => {
  assert.match(USER_AGENT, /^GhostLeadsBot\/1\.0 \(\+https?:\/\/[^)]+\/bot\)$/);
});

// --- readBody: the cap counts decompressed bytes and stops the decoder ---

async function withServer(body: Buffer, encoding: string | null, run: (res: http.IncomingMessage) => Promise<void>) {
  const server = http.createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/html", ...(encoding ? { "content-encoding": encoding } : {}) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, agent: false }, (res) => run(res).then(resolve, reject)).on("error", reject);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const BOMB = Buffer.alloc(64 * 1024 * 1024, "a"); // 64 MB that compress to a few hundred bytes
const CAP = 100_000;

for (const [encoding, compress] of [["br", zlib.brotliCompressSync], ["gzip", zlib.gzipSync], ["deflate", zlib.deflateSync]] as const) {
  test(`readBody stops a ${encoding} bomb at the cap instead of inflating it`, async () => {
    const packed = compress(BOMB);
    assert.ok(packed.length < 200_000, "fixture is tiny on the wire");
    await withServer(packed, encoding, async (res) => {
      let inflated = 0; // every byte the decoder emits, including any after the cap
      const pipe = res.pipe.bind(res);
      res.pipe = ((dest: NodeJS.WritableStream) => {
        (dest as unknown as EventEmitter).on("data", (c: Buffer) => { inflated += c.length; });
        return pipe(dest);
      }) as typeof res.pipe;
      const body = await readBody(res, CAP);
      assert.equal(body.length, CAP);
      await new Promise((r) => setTimeout(r, 150)); // give a runaway decoder time to show itself
      assert.ok(inflated < CAP + 1024 * 1024, `decoder kept running: ${inflated} bytes inflated`);
      assert.equal(res.destroyed, true);
    });
  });
}

test("readBody returns small bodies whole and caps plain ones", async () => {
  await withServer(zlib.gzipSync("<p>hello</p>"), "gzip", async (res) => assert.equal((await readBody(res, CAP)).toString(), "<p>hello</p>"));
  await withServer(Buffer.alloc(500_000, "x"), null, async (res) => assert.equal((await readBody(res, CAP)).length, CAP));
});

test("readBody rejects a corrupt compressed body", async () => {
  await withServer(Buffer.from("this is not gzip"), "gzip", async (res) => { await assert.rejects(readBody(res, CAP)); });
});

// --- safeFetch: redirects, robots.txt, content types (canned https responses) ---

afterEach(() => mock.restoreAll());
const html = HTML;
const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string }) => e.code);

test("safeFetch returns the page and follows public redirects", async () => {
  const requested = cannedHttps({
    "https://a.example.com/start": { status: 302, headers: { location: "https://b.example.org/landed" } },
    "https://b.example.org/landed": { status: 200, headers: html, body: "<h1>Hi</h1>" },
  });
  const page = await safeFetch("https://a.example.com/start");
  assert.equal(page.url, "https://b.example.org/landed");
  assert.equal(page.text, "<h1>Hi</h1>");
  assert.deepEqual(requested, [
    "https://a.example.com/robots.txt", "https://a.example.com/start", "https://b.example.org/robots.txt", "https://b.example.org/landed",
  ]);
});

test("safeFetch re-checks every redirect hop and never requests a private target", async () => {
  for (const target of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://internal/", "file:///etc/passwd", "https://c.example.com:8443/"]) {
    const requested = cannedHttps({ "https://c.example.com/go": { status: 302, headers: { location: target } } });
    const code = await codeOf(safeFetch("https://c.example.com/go"));
    assert.ok(code === "blocked" || code === "bad_request", `${target} -> ${code}`);
    assert.equal(requested.at(-1), "https://c.example.com/go", `nothing requested after the redirect to ${target}`);
    assert.ok(requested.every((u) => u.startsWith("https://c.example.com/")), target);
    mock.restoreAll();
  }
});

test("safeFetch stops after five redirects", async () => {
  const hops: Record<string, Canned> = {};
  for (let i = 0; i < 8; i++) hops[`https://d.example.com/${i}`] = { status: 301, headers: { location: `/${i + 1}` } };
  cannedHttps(hops);
  await assert.rejects(safeFetch("https://d.example.com/0"), /Too many redirects/);
});

test("safeFetch obeys robots.txt: disallowed pages are not requested", async () => {
  const requested = cannedHttps({
    "https://e.example.com/robots.txt": { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /private/\n" },
    "https://e.example.com/private/list": { status: 200, headers: html, body: "secret" },
    "https://e.example.com/public": { status: 200, headers: html, body: "fine" },
  });
  assert.equal(await codeOf(safeFetch("https://e.example.com/private/list")), "blocked");
  assert.equal((await safeFetch("https://e.example.com/public")).text, "fine");
  assert.deepEqual(requested, ["https://e.example.com/robots.txt", "https://e.example.com/public"]); // robots.txt cached per host
});

test("safeFetch treats a missing robots.txt as allowed and a failing one as off limits", async () => {
  cannedHttps({
    "https://f.example.com/page": { status: 200, headers: html, body: "ok" },
    "https://g.example.com/robots.txt": { status: 503 },
    "https://g.example.com/page": { status: 200, headers: html, body: "ok" },
  });
  assert.equal((await safeFetch("https://f.example.com/page")).text, "ok");
  assert.equal(await codeOf(safeFetch("https://g.example.com/page")), "blocked");
});

test("safeFetch refuses non-web content types and reports HTTP errors as upstream", async () => {
  cannedHttps({
    "https://h.example.com/file.pdf": { status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF" },
    "https://h.example.com/image": { status: 200, headers: { "content-type": "image/png" }, body: "png" },
    "https://h.example.com/data.json": { status: 200, headers: { "content-type": "application/json" }, body: "{\"a\":1}" },
    "https://h.example.com/gone": { status: 410 },
  });
  assert.equal(await codeOf(safeFetch("https://h.example.com/file.pdf")), "blocked");
  assert.equal(await codeOf(safeFetch("https://h.example.com/image")), "blocked");
  assert.equal((await safeFetch("https://h.example.com/data.json")).text, "{\"a\":1}");
  assert.equal(await codeOf(safeFetch("https://h.example.com/gone")), "upstream");
});

test("safeFetch decodes the charset the page declares", async () => {
  cannedHttps({
    "https://i.example.com/": { status: 200, headers: { "content-type": "text/html; charset=iso-8859-1" }, body: Buffer.from("Geschäftsführer", "latin1") },
  });
  assert.equal((await safeFetch("https://i.example.com/")).text, "Geschäftsführer");
});
