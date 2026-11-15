import type { DraftRequest } from "../shared/types.js";
import { draft } from "../server/draft.js";
import { ApiFail, endpoint, str, type Body } from "../server/http.js";

export default endpoint("draft", (body) => {
  if (body.channel !== "email" && body.channel !== "linkedin") throw new ApiFail("bad_request", '"channel" must be email or linkedin');
  const offer = str(body, "offer", 1000);
  const prospect = body.prospect as DraftRequest["prospect"];
  if (!prospect || typeof prospect !== "object") throw new ApiFail("bad_request", '"prospect" is required');
  str(prospect as unknown as Body, "company_name", 200);
  if (JSON.stringify(prospect).length > 8000) throw new ApiFail("bad_request", '"prospect" is too large');
  const channel = body.channel;
  return { run: () => draft(channel, offer, prospect) };
});
