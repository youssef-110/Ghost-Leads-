import type { VerifyResponse } from "../shared/types.js";
import { checkEmail } from "../server/email.js";
import { ApiFail, endpoint } from "../server/http.js";

export default endpoint("verify", (body) => {
  const emails = body.emails;
  if (!Array.isArray(emails) || !emails.length || emails.length > 50 || emails.some((e) => typeof e !== "string" || e.length > 254)) {
    throw new ApiFail("bad_request", '"emails" must be a list of 1 to 50 addresses');
  }
  return {
    n: emails.length,
    run: async (): Promise<VerifyResponse> => ({ results: await Promise.all(emails.map((e: string) => checkEmail(e, null))) }),
  };
});
