import { enrich, normalizeDomain } from "../server/enrich.js";
import { endpoint, optStr, str } from "../server/http.js";

export default endpoint("enrich", (body) => {
  const domain = normalizeDomain(str(body, "domain", 253));
  const companyName = optStr(body, "company_name", 200);
  return { run: () => enrich(domain, companyName) };
});
