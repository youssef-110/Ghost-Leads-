// Validates a discover request and picks the source. Validation is synchronous so it runs before metering.
import type { DiscoverResponse } from "../shared/types.js";
import { checkUrl } from "./fetch.js";
import { ApiFail, limitOf, optStr, str, type Body } from "./http.js";
import { directory } from "./sources/directory.js";
import { hiring } from "./sources/hiring.js";
import { linkedin } from "./sources/linkedin.js";
import { maps } from "./sources/maps.js";
import { startups } from "./sources/startups.js";
import { web } from "./sources/web.js";

export function prepareDiscover(body: Body): () => Promise<DiscoverResponse> {
  const limit = limitOf(body, 25, 100);
  switch (body.source) {
    case "maps": {
      const [query, location] = [str(body, "query", 100), str(body, "location", 120)];
      return () => maps(query, location, limit);
    }
    case "web": {
      const query = str(body, "query", 200);
      return () => web(query, limit);
    }
    case "startups": {
      const filters = { query: optStr(body, "query", 100), industry: optStr(body, "industry", 60), location: optStr(body, "location", 80), hiring: body.hiring === true };
      return () => startups(filters, limit);
    }
    case "hiring": {
      const [query, location] = [str(body, "query", 100), optStr(body, "location", 80)];
      return () => hiring(query, location, limit);
    }
    case "directory": {
      const url = checkUrl(str(body, "url", 2000)).href;
      return () => directory(url, limit);
    }
    case "linkedin": {
      const mode = body.mode === "posts" ? "posts" : "people";
      const [query, location] = [str(body, "query", 200), optStr(body, "location", 80)];
      return () => linkedin(mode, query, location, limit);
    }
    default:
      throw new ApiFail("bad_request", '"source" must be one of maps, web, startups, hiring, directory, linkedin');
  }
}
