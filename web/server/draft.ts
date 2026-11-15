// Outreach opener from the prospect's facts and the sender's offer. Honesty rules ported from
// src/ghostleads/backend/draft.py and outreach.json: only facts in the input, nothing invented.
import type { DraftRequest, DraftResponse } from "../shared/types.js";
import { ApiFail } from "./http.js";
import { aiConfigured, chatJson, type ChatMessage } from "./openai.js";

const LINKEDIN_MAX_CHARS = 280;
const EMAIL_MAX_WORDS = 90;

const RULES = `Rules:
- Write in the language of OFFER.
- Use only the facts in FACTS and OFFER. Never invent numbers, results, mutual contacts, products, customers or claims.
  Never claim you met, saw, called or talked to them, or that you use their product.
- Open with one concrete fact about them from FACTS (their role, what the company does, a signal such as an open role).
  If FACTS has no usable detail, open plainly with what you do; do not make one up.
- Say in plain words what the sender offers, using OFFER; do not add benefits OFFER does not state.
- End with one short, low-pressure question.
- Greet the person by name if FACTS has one, otherwise greet the company's team.
- No emojis, no hashtags, no "I hope this finds you well", no placeholders such as [Name], no signature.`;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["subject", "message"],
  properties: { subject: { type: ["string", "null"] }, message: { type: "string" } },
};

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** No AI key: a plain opener assembled from the same facts, for the user to edit.
 *  shortcut: English only and one fixed structure; the AI path writes in the language of the offer. */
export function templateDraft(channel: DraftRequest["channel"], offer: string, p: DraftRequest["prospect"]): DraftResponse {
  const first = p.person?.name?.trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first},` : `Hi ${p.company_name} team,`;
  const role = p.signals?.find((s) => s.kind === "hiring")?.label.replace(/^Hiring: /, "");
  const opener = role ? `I saw ${p.company_name} is hiring for ${role}.`
    : p.person?.title ? `I am writing to you as ${p.person.title}${p.person.name === p.company_name ? "" : ` at ${p.company_name}`}.`
    : `I came across ${p.company_name}${p.city ? ` in ${p.city}` : ""}.`;
  const pitch = offer.trim().replace(/[.!?]*$/, ".");
  const ask = "Would a short call be useful?";
  if (channel === "email") {
    return { subject: `Quick question for ${p.company_name}`.slice(0, 80), message: `${hello}\n\n${opener} ${pitch}\n\n${ask}` };
  }
  const room = LINKEDIN_MAX_CHARS - `${hello} ${opener}  ${ask}`.length;
  const short = pitch.length > room ? pitch.slice(0, Math.max(0, room - 1)) + "…" : pitch;
  return { subject: null, message: `${hello} ${opener} ${short} ${ask}`.slice(0, LINKEDIN_MAX_CHARS) };
}

export async function draft(channel: DraftRequest["channel"], offer: string, prospect: DraftRequest["prospect"]): Promise<DraftResponse> {
  if (!aiConfigured()) return templateDraft(channel, offer, prospect);
  const email = channel === "email";
  const format = email
    ? `Write a cold email: a subject line of at most 8 words and a body of at most ${EMAIL_MAX_WORDS} words in 2-3 short paragraphs.`
    : `Write a LinkedIn connection note of at most ${LINKEDIN_MAX_CHARS - 30} characters in total, two or three short lines. Set subject to null.`;
  const facts = {
    company: prospect.company_name, about: prospect.description, industry: prospect.industry, city: prospect.city,
    person: prospect.person?.name, role: prospect.person?.title,
    signals: prospect.signals?.map((s) => s.label), uses: prospect.tech?.slice(0, 8),
  };
  const messages: ChatMessage[] = [
    { role: "system", content: `${format}\n${RULES}` },
    { role: "user", content: `OFFER: ${offer}\nFACTS:\n${JSON.stringify(facts)}` },
  ];
  const tooLong = (m: string) => (email ? words(m) > EMAIL_MAX_WORDS : m.length > LINKEDIN_MAX_CHARS);
  let out = await chatJson<DraftResponse>(messages, "outreach_draft", SCHEMA, 0.4);
  for (let tries = 0; tooLong(out.message) && tries < 2; tries++) { // models overshoot length limits; ask again with the count
    messages.push(
      { role: "assistant", content: JSON.stringify(out) },
      { role: "user", content: email
        ? `That body is ${words(out.message)} words. Rewrite it under ${EMAIL_MAX_WORDS - 15} words.`
        : `That is ${out.message.length} characters. Rewrite it under ${LINKEDIN_MAX_CHARS - 50} characters.` },
    );
    out = await chatJson<DraftResponse>(messages, "outreach_draft", SCHEMA, 0.4);
  }
  const message = out.message.trim();
  if (tooLong(message)) throw new ApiFail("upstream", "The AI could not keep the draft short enough. Try again.");
  return { subject: email ? out.subject?.trim() || prospect.company_name : null, message };
}
