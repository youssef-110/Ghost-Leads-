import { prepareDiscover } from "../server/discover.js";
import { endpoint } from "../server/http.js";

export default endpoint("discover", (body) => ({ run: prepareDiscover(body) }));
