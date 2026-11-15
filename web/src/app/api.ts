// Typed client for the same-origin Vercel functions in web/api. Every failure becomes an ApiFailure with a human message.
import { supabase } from "../lib";
import type {
  ApiError, DiscoverRequest, DiscoverResponse, DraftRequest, DraftResponse, Enrichment, EnrichRequest,
  ExtractRequest, ExtractResponse, Health, VerifyRequest, VerifyResponse,
} from "../../shared/types";
import { codeForStatus, failMessage, type FailCode } from "./logic";

export class ApiFailure extends Error {
  code: FailCode;
  constructor(code: FailCode, endpoint: string, detail?: string | null) {
    super(failMessage(code, endpoint, detail));
    this.code = code;
  }
}

async function call<T>(endpoint: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiFailure("unauthorized", endpoint);
  let res: Response;
  try {
    res = await fetch(`/api/${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    // a timeout is one slow site, not a dead connection
    throw new ApiFailure(e instanceof DOMException && e.name === "TimeoutError" ? "upstream" : "network", endpoint);
  }
  // a dev server or a deployment without the functions answers with HTML: treat anything that is not JSON as unavailable
  const json: unknown = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (res.ok && json) return json as T;
  const err = json as Partial<ApiError> | null;
  throw new ApiFailure(err?.code ?? (res.ok ? "unavailable" : codeForStatus(res.status)), endpoint, err?.error);
}

export const api = {
  discover: (b: DiscoverRequest) => call<DiscoverResponse>("discover", b),
  enrich: (b: EnrichRequest) => call<Enrichment>("enrich", b),
  extract: (b: ExtractRequest) => call<ExtractResponse>("extract", b),
  draft: (b: DraftRequest) => call<DraftResponse>("draft", b),
  verify: (b: VerifyRequest) => call<VerifyResponse>("verify", b),
  health: () => call<Health>("health"),
};
