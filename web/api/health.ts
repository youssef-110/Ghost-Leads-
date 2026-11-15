import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Health } from "../shared/types.js";
import { aiConfigured } from "../server/openai.js";

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    ai: aiConfigured(),
    search: process.env.SERPER_API_KEY ? "serper" : "none",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  } satisfies Health);
}
