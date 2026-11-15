// Shared request plumbing for the Vercel functions: errors, input checks, auth + metering.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ApiError, Usage } from "../shared/types.js";

const STATUS: Record<ApiError["code"], number> = {
  bad_request: 400, unauthorized: 401, blocked: 422, quota: 429, upstream: 502, not_configured: 503,
};

export class ApiFail extends Error {
  code: ApiError["code"];
  constructor(code: ApiError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// Publishable defaults, same as web/src/lib.ts (public by design).
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://spsaeysttztcifqjaalw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_CHvJbQUZa3NtuL7GFB5pbw_jJOmMly6";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Body = Record<string, unknown>;

export function str(body: Body, key: string, max = 300): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) throw new ApiFail("bad_request", `"${key}" is required`);
  if (v.length > max) throw new ApiFail("bad_request", `"${key}" is longer than ${max} characters`);
  return v.trim();
}

export function optStr(body: Body, key: string, max = 300): string | undefined {
  return body[key] == null || body[key] === "" ? undefined : str(body, key, max);
}

/** Whole number in [1, max]; `fallback` when absent. */
export function limitOf(body: Body, fallback: number, max: number): number {
  const v = body.limit;
  if (v == null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new ApiFail("bad_request", '"limit" must be a positive whole number');
  return Math.min(v, max);
}

/** Counts the call against the workspace's daily quota. gl_use() runs with the caller's own token, so
 *  PostgREST verifying that token is the authentication and gl_use's membership check is the authorization. */
async function meter(token: string, ws: string, kind: Usage["kind"], n: number): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gl_use`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ p_ws: ws, p_kind: kind, p_n: n }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiFail("upstream", "Could not reach the account service");
  }
  if (res.ok) return;
  const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (res.status === 401 || res.status === 403 || err.code === "42501") {
    throw new ApiFail("unauthorized", "Sign in again, or check that you belong to this workspace");
  }
  if (err.code === "P0001" && err.message === "quota") throw new ApiFail("quota", `Daily ${kind} limit reached for this workspace`);
  if (err.code === "22023") throw new ApiFail("bad_request", "Bad amount");
  throw new ApiFail("upstream", "Account service error");
}

function fail(res: VercelResponse, e: unknown): void {
  if (e instanceof ApiFail) {
    res.status(STATUS[e.code]).json({ error: e.message, code: e.code } satisfies ApiError);
    return;
  }
  console.error(e);
  res.status(502).json({ error: "Unexpected server error", code: "upstream" } satisfies ApiError);
}

/** A metered POST endpoint. `prepare` validates the body (no I/O) and returns the amount to meter plus the
 *  work to run once the quota check has passed. */
export function endpoint<T>(kind: Usage["kind"], prepare: (body: Body) => { n?: number; run: () => Promise<T> }) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    try {
      if (req.method !== "POST") throw new ApiFail("bad_request", "Use POST");
      const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!token) throw new ApiFail("unauthorized", "Missing access token");
      const body: unknown = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiFail("bad_request", "Send a JSON object");
      const ws = str(body as Body, "ws", 36);
      if (!UUID.test(ws)) throw new ApiFail("bad_request", '"ws" must be a workspace id');
      const { n = 1, run } = prepare(body as Body);
      await meter(token, ws, kind, n);
      res.status(200).json(await run());
    } catch (e) {
      fail(res, e);
    }
  };
}
