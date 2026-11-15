// The one outbound fetcher for user-supplied and crawled URLs. Trust boundary: the URL comes from users.
// http/https only, public addresses only (checked at connect time, on every redirect hop), robots.txt respected.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { ApiFail } from "./http.js";
import { parseRobots, robotsAllows, type RobotsRule } from "./robots.js";

// The one place the public site origin lives; /bot there tells site owners what this crawler does and how to opt out.
export const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL ?? "https://ghost-leads.vercel.app").replace(/\/+$/, "");
export const USER_AGENT = `GhostLeadsBot/1.0 (+${PUBLIC_SITE_URL}/bot)`;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_TYPES = /^(text\/html|application\/xhtml\+xml|application\/json|application\/ld\+json|text\/xml|application\/xml|application\/(rss|atom)\+xml|text\/plain)\b/i;

const blockList = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], // incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockList.addSubnet(prefix, bits, "ipv4");
for (const [prefix, bits] of [
  ["::", 127], // unspecified and loopback
  ["64:ff9b::", 96], ["2001::", 32], ["2002::", 16], // NAT64, Teredo, 6to4: can tunnel to private IPv4
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
  ["fd00:ec2::", 32], // AWS IMDS over IPv6 (inside fc00::/7, listed for the record)
] as const) blockList.addSubnet(prefix, bits, "ipv6");

/** True for anything that is not a public unicast address. IPv4-mapped IPv6 is checked against the IPv4 list. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (!family) return true;
  return blockList.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Syntax-level check, safe to run before metering. Returns the parsed URL. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiFail("bad_request", "Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ApiFail("bad_request", "Only http and https URLs are supported");
  if (url.username || url.password) throw new ApiFail("bad_request", "URLs with credentials are not supported");
  if (url.port) throw new ApiFail("blocked", "Only the default web ports are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) ? isBlockedAddress(host) : !host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) {
    throw new ApiFail("blocked", "That address is not on the public internet");
  }
  url.hash = "";
  return url;
}

// Validates the addresses the socket is about to connect to, so a DNS answer cannot change between check and use.
export const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error("address not allowed"), { code: "EBLOCKED" }), "", 0);
    }
    if ((options as dns.LookupOptions).all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

/** Reads a response body, decompressing it, and stops at `maxBytes` of DECOMPRESSED data. At the cap the decoder,
 *  the response and its socket are all destroyed: a few hundred bytes of brotli can otherwise inflate to gigabytes.
 *  A capped body is returned truncated (HTML parses fine that way); a broken or aborted one rejects. */
export function readBody(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
    const decoder = encoding === "gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate()
      : encoding === "br" ? zlib.createBrotliDecompress() : null;
    const stream = decoder ? res.pipe(decoder) : res;
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      res.unpipe();
      decoder?.destroy();
      res.destroy(); // closes the socket, so nothing more is downloaded either
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).subarray(0, maxBytes));
    };
    stream.on("data", (chunk: Buffer) => {
      if (finished) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxBytes) finish();
    });
    stream.on("end", () => finish());
    stream.on("error", finish);
    if (stream !== res) res.on("error", finish);
  });
}

function request(url: URL, timeoutMs: number, maxBytes: number, anyType: boolean): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(url, {
      agent: false,
      lookup: guardedLookup,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,application/xml;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en,de;q=0.8",
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const type = String(res.headers["content-type"] ?? "");
      if (status >= 300 || (type && !anyType && !ALLOWED_TYPES.test(type))) { // body not needed
        res.destroy();
        clearTimeout(timer);
        return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
      }
      readBody(res, maxBytes)
        .then((body) => { clearTimeout(timer); resolve({ status, headers: res.headers, body }); }, fail)
        .finally(() => req.destroy());
    });
    const fail = (e: unknown) => { clearTimeout(timer); reject(e); };
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), timeoutMs);
    req.on("error", fail);
    req.end();
  });
}

function networkError(e: unknown, url: URL): ApiFail {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "EBLOCKED") return new ApiFail("blocked", "That address is not on the public internet");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new ApiFail("upstream", `Could not find ${url.hostname}`);
  if (code === "ETIMEDOUT") return new ApiFail("upstream", `${url.hostname} took too long to answer`);
  return new ApiFail("upstream", `Could not load ${url.hostname}`);
}

const robotsCache = new Map<string, { rules: RobotsRule[] | "deny"; at: number }>();

async function robotsFor(url: URL, timeoutMs: number): Promise<RobotsRule[] | "deny"> {
  const hit = robotsCache.get(url.origin);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.rules;
  let rules: RobotsRule[] | "deny";
  try {
    // robots.txt is read whatever content type the server labels it with
    const res = await safeFetch(url.origin + "/robots.txt", { robots: false, anyType: true, timeoutMs: Math.min(timeoutMs, 6000), maxBytes: 500_000 });
    rules = parseRobots(res.text);
  } catch (e) {
    // A private address, an unknown host or a dead connection: report that, it is why the page cannot be read either.
    if (!(e instanceof HttpStatusError)) throw e;
    // RFC 9309: a missing robots.txt (4xx) means no restrictions; a failing one (5xx) means stay out.
    rules = e.status >= 400 && e.status < 500 ? [] : "deny";
  }
  if (robotsCache.size > 500) robotsCache.clear();
  robotsCache.set(url.origin, { rules, at: Date.now() });
  return rules;
}

class HttpStatusError extends ApiFail {
  status: number;
  constructor(status: number, host: string) {
    super("upstream", `${host} answered with HTTP ${status}`);
    this.status = status;
  }
}

export type Page = { url: string; status: number; headers: http.IncomingHttpHeaders; contentType: string; text: string };

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
    ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString("latin1"))?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

/** Fetch a public page. Throws ApiFail: `blocked` (private address, robots.txt, wrong content type), `upstream` (network, HTTP error). */
export async function safeFetch(
  rawUrl: string, opts: { robots?: boolean; timeoutMs?: number; maxBytes?: number; anyType?: boolean } = {},
): Promise<Page> {
  const { robots = true, timeoutMs = 10_000, maxBytes = MAX_BYTES, anyType = false } = opts;
  const deadline = Date.now() + timeoutMs;
  let url = checkUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw networkError({ code: "ETIMEDOUT" }, url);
    if (robots) {
      const rules = await robotsFor(url, left);
      if (rules === "deny" || !robotsAllows(rules, url.pathname + url.search)) {
        throw new ApiFail("blocked", `${url.hostname} does not allow automated access to this page (robots.txt)`);
      }
    }
    let res: RawResponse;
    try {
      res = await request(url, Math.max(deadline - Date.now(), 1), maxBytes, anyType);
    } catch (e) {
      throw networkError(e, url);
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      if (hop >= MAX_REDIRECTS) throw new ApiFail("upstream", "Too many redirects");
      let next: URL;
      try {
        next = new URL(res.headers.location, url);
      } catch {
        throw new ApiFail("upstream", "Bad redirect");
      }
      url = checkUrl(next.href); // every hop is re-validated; the connect-time lookup guard applies again too
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new HttpStatusError(res.status, url.hostname);
    const contentType = String(res.headers["content-type"] ?? "");
    if (contentType && !anyType && !ALLOWED_TYPES.test(contentType)) {
      throw new ApiFail("blocked", `Not a web page (${contentType.split(";")[0]})`);
    }
    return { url: url.href, status: res.status, headers: res.headers, contentType, text: decode(res.body, contentType) };
  }
}

/** JSON from a fixed, trusted API host (Nominatim, Overpass, job boards...). Not for user-supplied URLs. */
export async function apiJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const host = new URL(url).hostname;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiFail("upstream", `${host} did not answer`);
  }
  if (!res.ok) throw new ApiFail("upstream", `${host} answered with HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiFail("upstream", `${host} sent an unreadable answer`);
  }
}
