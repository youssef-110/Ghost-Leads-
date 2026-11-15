// Local businesses from OpenStreetMap. Nominatim geocodes the place; the businesses come from Nominatim's tag search
// by default, or from an Overpass server when OVERPASS_URL is set. The public overpass-api.de instance is not a
// default: since April 2026 its terms exclude commercial use and it answers such clients with HTTP 406.
// Nominatim policy: identifying User-Agent, at most one request per second, results cached, no bulk downloads.
import type { DiscoverItem } from "../../shared/types.js";
import { normalizePhone } from "../contacts.js";
import { apiJson } from "../fetch.js";
import { clean } from "../html.js";
import { ApiFail } from "../http.js";
import { dedupe, item } from "./item.js";

// Search word -> OSM tags, most typical tag first. First match wins, so specific kinds of agency/adviser come
// before the generic ones.
const CATEGORIES: [RegExp, [string, string][]][] = [
  [/dentist|dental|zahn[aä]rzt/, [["amenity", "dentist"], ["healthcare", "dentist"]]],
  [/physio|physical therap/, [["healthcare", "physiotherapist"]]],
  [/\bvet\b|veterinar|tierarzt|tierärzt/, [["amenity", "veterinary"]]],
  [/pharmac|apotheke/, [["amenity", "pharmacy"]]],
  [/doctor|physician|clinic|\barzt\b|ärzt|praxis/, [["amenity", "doctors"], ["amenity", "clinic"]]],
  [/restaurant|gastst|diner|bistro/, [["amenity", "restaurant"]]],
  [/caf[eé]|coffee/, [["amenity", "cafe"]]],
  [/\bbars?\b|\bpubs?\b|kneipe/, [["amenity", "bar"], ["amenity", "pub"]]],
  [/hotel|hostel|guest ?house|pension\b|motel/, [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "hostel"], ["tourism", "motel"]]],
  [/lawyer|attorney|law firm|anwalt|anwält|kanzlei|notar/, [["office", "lawyer"], ["office", "notary"]]],
  [/gym|fitness/, [["leisure", "fitness_centre"]]],
  [/travel|reiseb/, [["shop", "travel_agency"], ["office", "travel_agent"]]],
  [/real estate|estate agent|realtor|immobilien|makler/, [["office", "estate_agent"]]],
  [/insurance|versicherung/, [["office", "insurance"]]],
  [/recruit|staffing|personalvermitt|personaldienst|zeitarbeit/, [["office", "employment_agency"]]],
  [/account|bookkeep|tax|steuerberat|buchhalt/, [["office", "accountant"], ["office", "tax_advisor"]]],
  [/architect|architekt/, [["office", "architect"]]],
  [/financ|finanz/, [["office", "financial"], ["office", "financial_advisor"]]],
  [/marketing|advertis|werbe|\bpr\b|public relations|agency|agentur/, [["office", "advertising_agency"], ["office", "marketing"], ["office", "public_relations"]]],
  [/\bit\b|software|tech company|computer|web ?design|developer|saas/, [["office", "it"], ["shop", "computer"]]],
  [/consult|berat/, [["office", "consulting"]]],
  [/engineer|ingenieur/, [["office", "engineer"]]],
  [/logistic|spedition|freight/, [["office", "logistics"]]],
  [/cowork/, [["amenity", "coworking_space"], ["office", "coworking"]]],
  [/baker|bäcker/, [["shop", "bakery"]]],
  [/hair|friseur|barber/, [["shop", "hairdresser"]]],
  [/beauty|kosmetik|nail/, [["shop", "beauty"]]],
  [/car repair|auto repair|mechanic|werkstatt/, [["shop", "car_repair"]]],
  [/car dealer|autohaus|car sales/, [["shop", "car"]]],
  [/plumb|klempner|sanitär|heizung|hvac/, [["craft", "plumber"], ["craft", "hvac"]]],
  [/electric|elektr/, [["craft", "electrician"]]],
  [/carpent|joiner|schreiner|tischler/, [["craft", "carpenter"], ["craft", "joiner"]]],
  [/roof|dachdeck/, [["craft", "roofer"]]],
  [/painter|maler/, [["craft", "painter"]]],
  [/photograph|fotograf/, [["craft", "photographer"], ["shop", "photo"]]],
  [/optic|optik/, [["shop", "optician"]]],
  [/florist|flower|blumen/, [["shop", "florist"]]],
  [/supermarket|grocer|lebensmittel/, [["shop", "supermarket"], ["shop", "convenience"]]],
  [/jewel|juwel|schmuck/, [["shop", "jewelry"]]],
  [/furniture|möbel/, [["shop", "furniture"]]],
  [/bike|bicycle|fahrrad/, [["shop", "bicycle"]]],
  [/cloth|fashion|boutique/, [["shop", "clothes"]]],
  [/\bbank/, [["amenity", "bank"]]],
  [/compan|firma|business|unternehmen|office|büro/, [["office", "company"]]],
];
const BUSINESS_KEYS = ["office", "shop", "craft", "amenity", "healthcare", "tourism", "leisure"];

/** OSM tags for a search phrase, or null when it is not a known category (then the phrase is matched against names). */
export function categoryTags(query: string): [string, string][] | null {
  const q = query.toLowerCase();
  return CATEGORIES.find(([re]) => re.test(q))?.[1] ?? null;
}

type Element = { type: string; id: number; tags?: Record<string, string> };
type NominatimHit = {
  osm_type: string; osm_id: number; name: string; category: string; type: string; boundingbox: string[];
  extratags?: Record<string, string> | null;
  address?: { road?: string; house_number?: string; postcode?: string; city?: string; town?: string; village?: string; country?: string; country_code?: string };
};

const NOMINATIM = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&accept-language=en";
let lastNominatimCall = 0;

async function nominatim(params: string): Promise<NominatimHit[]> {
  const wait = lastNominatimCall + 1100 - Date.now(); // usage policy: at most one request per second
  lastNominatimCall = Date.now() + Math.max(wait, 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return apiJson<NominatimHit[]>(NOMINATIM + params);
}

const places = new Map<string, NominatimHit>();

async function geocode(location: string): Promise<NominatimHit> {
  const key = location.toLowerCase();
  const hit = places.get(key) ?? (await nominatim("&limit=1&q=" + encodeURIComponent(location)))[0];
  if (!hit) throw new ApiFail("bad_request", `Could not find a place called "${location}"`);
  if (places.size > 200) places.clear();
  places.set(key, hit);
  return hit;
}

/** Nominatim's answer in the shape Overpass uses, so one mapper serves both. */
export function toElement(h: NominatimHit): Element {
  const a = h.address ?? {};
  const tags: Record<string, string> = { ...(h.extratags ?? {}), name: h.name, [h.category]: h.type };
  const address = { "addr:street": a.road, "addr:housenumber": a.house_number, "addr:postcode": a.postcode, "addr:city": a.city ?? a.town ?? a.village };
  for (const [k, v] of Object.entries(address)) if (v) tags[k] = v;
  return { type: h.osm_type, id: h.osm_id, tags };
}

const NUMBER_FIRST = new Set(["us", "ca", "gb", "ie", "au", "nz", "fr"]); // "500 Main St" rather than "Hauptstraße 5"

export function toItem(el: Element, place: { name: string; country: string | null; countryCode?: string }): DiscoverItem | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const first = (...keys: string[]) => keys.map((k) => t[k]?.split(";")[0].trim()).find(Boolean) ?? null;
  const site = first("website", "contact:website", "url");
  const parts = [t["addr:street"], t["addr:housenumber"]].filter(Boolean);
  const street = (NUMBER_FIRST.has(place.countryCode ?? "") ? parts.reverse() : parts).join(" ");
  const city = t["addr:city"] ?? place.name;
  const kind = BUSINESS_KEYS.map((k) => t[k]).find((v) => v && v !== "yes");
  return item("maps", clean(t.name), {
    website: site ? (/^https?:\/\//i.test(site) ? site : "https://" + site) : null,
    phone: normalizePhone(first("phone", "contact:phone", "contact:mobile") ?? ""),
    email: first("email", "contact:email")?.toLowerCase() ?? null,
    address: street ? [street, [t["addr:postcode"], city].filter(Boolean).join(" ")].join(", ") : null,
    city, country: place.country,
    industry: kind ? kind.replace(/_/g, " ") : null,
    description: t.description ? clean(t.description).slice(0, 300) : null,
    source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  });
}

/** Overpass QL for the businesses inside a bounding box ("south,west,north,east"). */
export function overpassQuery(query: string, bbox: string): string {
  const tags = categoryTags(query);
  const name = query.replace(/[\\"]/g, "").replace(/[.*+?^${}()|[\]]/g, "\\\\$&");
  const filters = tags
    ? tags.map(([k, v]) => `["${k}"="${v}"]`)
    : [`["name"~"${name}",i][~"^(${BUSINESS_KEYS.join("|")})$"~"."]`];
  return `[out:json][timeout:25];(${filters.map((f) => `nwr${f}(${bbox});`).join("")});out center tags 400;`;
}

async function search(query: string, place: NominatimHit): Promise<Element[]> {
  const [south, north, west, east] = place.boundingbox;
  if (process.env.OVERPASS_URL) {
    const res = await apiJson<{ elements: Element[] }>(process.env.OVERPASS_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(overpassQuery(query, [south, west, north, east].join(","))),
    }, 40_000);
    return res.elements;
  }
  // Nominatim takes one tag per request ("[office=lawyer]"), so only the category's main tag is searched
  const tag = categoryTags(query)?.[0];
  const hits = await nominatim(`&limit=40&bounded=1&viewbox=${west},${north},${east},${south}&q=` + encodeURIComponent(tag ? `[${tag[0]}=${tag[1]}]` : query));
  return hits.filter((h) => BUSINESS_KEYS.includes(h.category)).map(toElement);
}

export async function maps(query: string, location: string, limit: number): Promise<{ items: DiscoverItem[]; note: string | null }> {
  const place = await geocode(location);
  const elements = await search(query, place);
  const where = { name: place.name, country: place.address?.country ?? null, countryCode: place.address?.country_code };
  const all = dedupe(elements.map((el) => toItem(el, where)).filter((i): i is DiscoverItem => i !== null));
  // businesses we can actually reach come first
  const rank = (i: DiscoverItem) => (i.website ? 4 : 0) + (i.email ? 2 : 0) + (i.phone ? 1 : 0);
  const items = all.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
  return {
    items,
    note: items.length
      ? "Data © OpenStreetMap contributors (ODbL)."
      : `OpenStreetMap lists no "${query}" in ${place.name}. Try a broader word or a larger area.`,
  };
}
