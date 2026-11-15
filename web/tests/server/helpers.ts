// Shared test doubles: canned responses for the http(s) client behind safeFetch, and for global fetch.
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { mock } from "node:test";

export type Canned = { status: number; headers?: Record<string, string>; body?: string | Buffer };

/** Serves `responses` by URL to safeFetch (anything else is a 404). Returns the list of requested URLs. */
export function cannedHttps(responses: Record<string, Canned>): string[] {
  const requested: string[] = [];
  const fake = (url: URL, _options: unknown, onResponse: (res: unknown) => void) => Object.assign(new EventEmitter(), {
    destroy() {},
    end() {
      requested.push(url.href);
      const canned = responses[url.href] ?? { status: 404 };
      const res = Object.assign(Readable.from(canned.body ? [Buffer.from(canned.body)] : []), { statusCode: canned.status, headers: canned.headers ?? {} });
      setImmediate(() => onResponse(res));
    },
  });
  mock.method(https, "request", fake as unknown as typeof https.request);
  mock.method(http, "request", fake as unknown as typeof http.request);
  return requested;
}

export const HTML = { "content-type": "text/html; charset=utf-8" };

/** Replaces global fetch. `reply` gets the parsed JSON body of each call and returns the JSON to answer with. */
export function cannedFetch(reply: (body: Record<string, unknown>, url: string) => unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string>, body });
    return new Response(JSON.stringify(reply(body, String(url))), { status });
  });
  return calls;
}

/** An OpenAI chat-completions answer whose message content is `value` as JSON. */
export const completion = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
