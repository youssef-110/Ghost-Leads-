import type { DiscoverItem, Source } from "../../shared/types.js";
import { domainOf } from "../html.js";

// Registrable domains that are never a company's own website, wherever the link appears: social networks, link
// shorteners, shared hosts of site builders, encyclopedias, the sources this engine reads.
const PLATFORMS = new Set(`
linkedin.com facebook.com fb.com twitter.com x.com instagram.com youtube.com youtu.be tiktok.com pinterest.com
reddit.com medium.com quora.com threads.net xing.com whatsapp.com t.me telegram.org discord.com discord.gg
snapchat.com vimeo.com twitch.tv substack.com github.com gitlab.com bsky.app mastodon.social flickr.com
wikipedia.org wikidata.org wikimedia.org goo.gl archive.org bit.ly linktr.ee wixsite.com jimdosite.com wordpress.com
blogspot.com webflow.io openstreetmap.org ycombinator.com himalayas.app arbeitnow.com
`.split(/\s+/).filter(Boolean));

// Sites that crowd web search results without being the company searched for: marketplaces, directories, review
// and job sites, news. Only filtered from search results; on a member or sponsor list they are real companies.
const SEARCH_NOISE = new Set(`
kununu.com glassdoor.com indeed.com stepstone.de amazon.com amazon.de ebay.com ebay.de etsy.com alibaba.com
aliexpress.com walmart.com otto.de idealo.de yelp.com yelp.de yellowpages.com gelbeseiten.de dasoertliche.de 11880.com
meinestadt.de golocal.de cylex.de tripadvisor.com tripadvisor.de booking.com trustpilot.com g2.com capterra.com
capterra.com.de getapp.com clutch.co crunchbase.com zoominfo.com apollo.io dnb.com northdata.de northdata.com wlw.de
europages.com europages.de kompass.com producthunt.com angel.co wellfound.com bbb.org thumbtack.com angi.com houzz.com
jameda.de doctolib.de healthgrades.com zocdoc.com opentable.com lieferando.de avvo.com justia.com anwalt.de
google.com google.de apple.com microsoft.com bing.com duckduckgo.com yahoo.com
nytimes.com forbes.com bloomberg.com reuters.com techcrunch.com businessinsider.com wsj.com theguardian.com bbc.com
bbc.co.uk cnn.com spiegel.de zeit.de faz.net handelsblatt.com heise.de t3n.de sueddeutsche.de focus.de welt.de
`.split(/\s+/).filter(Boolean));

/** The company's own registrable domain for a URL, or null when the URL points at a platform rather than a company site. */
export function companyDomain(url: string | null | undefined): string | null {
  const domain = domainOf(url);
  return domain && !PLATFORMS.has(domain) ? domain : null;
}

/** Stricter variant for search results: also drops marketplaces, directories and news sites. */
export function searchResultDomain(url: string): string | null {
  const domain = companyDomain(url);
  return domain && !SEARCH_NOISE.has(domain) ? domain : null;
}

/** A DiscoverItem with every field present; `domain` is derived from `website`. */
export function item(source: Source, company_name: string, fields: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    company_name, website: null, domain: companyDomain(fields.website), phone: null, email: null, address: null, city: null,
    country: null, industry: null, description: null, source, source_url: null, signals: [], ...fields,
  };
}

/** Keep the first item per registrable domain (items without a company domain are kept by name). */
export function dedupe(items: DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.domain ?? "name:" + i.company_name.toLowerCase();
    return !seen.has(key) && Boolean(seen.add(key));
  });
}
