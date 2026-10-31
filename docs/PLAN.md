# Ghost Leads: plan

## The idea
Ghost Leads finds companies that exist but sit in no lead database ("ghosts"), picks them by an event signal (exhibitors, speakers, sponsors of a trade fair or conference), turns them into verified leads with a named decision maker, writes an opener that references the event, and starts the conversation on LinkedIn through Needle.

One-sentence pitch: "We found the companies exhibiting at <event> that no lead database knows, enriched the owner, and started the conversation before the event: a lead source Arvana can sell around any trade fair."

## Why this won the council
A five-seat council (Strategist, Herald, Architect, Skeptic, AE) scored five ideas. All five rejected the Meta creative factory, GEO and a closed-loop optimizer (no ad budget, results take weeks, no reply data in five hours). Four of five backed a Dark TAM engine as the spine. Event triggers were added afterwards because they give a warm reason to reach out, fit Needle (LinkedIn only), and trade-fair exhibitor lists are a named dark-TAM source.

Niche: IT service providers (Systemhaeuser, managed-service providers) in Germany, Austria, Switzerland.
- Roughly 10-15k exist (estimate, not verified).
- The owner is named on the Impressum page, which German law requires.
- They buy outbound and ads, so they match Arvana's own customer profile.
- Fallback niche if the AI Ark overlap test fails: asset managers and family offices.
The event itself is chosen by the marketer. Pick a real upcoming or very recent event in the niche and verify its date.

## Pipeline
1. Event source: exhibitor, speaker and sponsor pages of one event (public pages only).
2. Resolve each company to a bare domain.
3. Check the domain against AI Ark. Keep only misses (in_aiark = 0). These are the ghosts and the only leads that count.
4. Impressum: fetch /impressum, extract owner name, title, email, phone with an OpenAI structured-output call.
5. Enrich the ghosts: Blitz (decision maker, LinkedIn URL, email, phone), Lusha for the top ~20.
6. Verify emails (ZeroBounce or Prospeo or tryKitt).
7. Personalize: a short opener that references the event and a scraped fact.
8. Send 10-20 LinkedIn touches through Needle. Email is shown as drafted and verified only.
9. Dashboard: funnel counts (found, ghost, enriched, verified, drafted, sent, accepted, replied), cost per verified ghost lead, one lead shown live through every stage.

## Pre-test (do first)
Check 20 leads against AI Ark. If more than half are already in it, switch to the fallback niche. AI Ark's API may not offer a single-domain lookup: if so, export a bulk list and diff locally. Ask the AI Ark team on site.

## Timeline (written at 13:30, hacking ends 17:00)
- 13:30 to 14:00: shared data contract merged, pre-test, both devs set up env and keys.
- 14:00 to 15:15: build the owned modules.
- 15:15: first full end-to-end run on real data (even 10 leads).
- 15:45: feature freeze. Only fixes after this.
- 16:00: record the 2-minute video.
- 16:45: submit. Keep 15 minutes of buffer.

## Video outline (2 minutes)
- 0:00 hook with a real number from our run.
- 0:15 the event and where the leads came from.
- 0:40 live AI Ark check, "NOT IN DB" badge, counters.
- 1:05 one lead through every stage: Impressum owner, enrichment, verified email, opener.
- 1:30 real Needle touch sent. Show any real accept or reply, even one.
- 1:45 business case for Arvana: cost per lead, price per list, productized around any event. Ask: pilot with one Arvana client on Monday.

## How it helps each sponsor
- Arvana: a repeatable, sellable lead source and service, for their own ICP.
- AI Ark: used as the baseline. Frame as "AI Ark plus ghost leads equals full coverage" and offer them the ghost list.
- Blitz and Lusha: enrichment steps, hit rates shown on camera.
- Needle: the outreach channel, its real send is the proof of end-to-end.
- OpenAI: Codex builds the code, the API writes the personalization. Say so in the video.
- Faxxing (optional stunt): one real fax to a teammate's number on camera, only if time remains.

## Do not
- Send bulk cold email to German recipients.
- Build a self-optimizing loop or dashboard we cannot feed with real data.
- State any number the pipeline did not produce. No fake replies. Label projections as projections.
- Scrape private attendee registrations or personal data beyond public professional info.
- Commit API keys. Keys live in .env (gitignored).

## Unverified (check on site)
AI Ark API surface and rate limits, Needle connect/message limits, Zapmail availability, sponsor prize details, whether the 12:30 team submission was completed.
