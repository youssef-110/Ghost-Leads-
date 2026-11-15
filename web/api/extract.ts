import { extract } from "../server/extract.js";
import { checkUrl } from "../server/fetch.js";
import { ApiFail, endpoint, optStr, str } from "../server/http.js";

export default endpoint("extract", (body) => {
  const url = checkUrl(str(body, "url", 2000)).href;
  const fields = body.fields ?? [];
  if (!Array.isArray(fields) || fields.length > 30 || fields.some((f) => typeof f !== "string" || !f.trim() || f.length > 60)) {
    throw new ApiFail("bad_request", '"fields" must be up to 30 short column names');
  }
  const instructions = optStr(body, "instructions", 1000);
  return { run: () => extract(url, [...new Set(fields.map((f: string) => f.trim()))], instructions) };
});
