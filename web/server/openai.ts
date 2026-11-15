// OpenAI chat completions with a strict JSON schema, over plain fetch (no SDK).
import { ApiFail } from "./http.js";

export const aiConfigured = (): boolean => Boolean(process.env.OPENAI_API_KEY);

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chatJson<T>(messages: ChatMessage[], schemaName: string, schema: object, temperature = 0): Promise<T> {
  if (!aiConfigured()) throw new ApiFail("not_configured", "AI features need an OpenAI API key on the server");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", // same default as src/ghostleads/backend/draft.py
        temperature, messages,
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new ApiFail("upstream", "The AI provider did not answer in time");
  }
  if (!res.ok) throw new ApiFail("upstream", `The AI provider answered with HTTP ${res.status}`);
  try {
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0].message.content) as T;
  } catch {
    throw new ApiFail("upstream", "The AI provider sent an unreadable answer");
  }
}
