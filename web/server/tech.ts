// Tech stack detection from the homepage HTML and response headers. One signature per tool: a pattern that only
// that tool's script, markup or header produces.
type Signature = { name: string; html?: RegExp; header?: [string, RegExp] };

const SIGNATURES: Signature[] = [
  // CMS / site builders
  { name: "WordPress", html: /\/wp-(?:content|includes)\/|<meta[^>]+generator[^>]+WordPress/i },
  { name: "Shopify", html: /cdn\.shopify\.com|Shopify\.theme/i, header: ["x-shopid", /./] },
  { name: "Wix", html: /static\.wixstatic\.com|static\.parastorage\.com/i, header: ["x-wix-request-id", /./] },
  { name: "Squarespace", html: /static1\.squarespace\.com|squarespace-cdn\.com/i },
  { name: "Webflow", html: /assets\.website-files\.com|cdn\.prod\.website-files\.com|data-wf-site=/i },
  { name: "Drupal", html: /<meta[^>]+generator[^>]+Drupal|\/sites\/default\/files\//i, header: ["x-generator", /drupal/i] },
  { name: "Joomla", html: /<meta[^>]+generator[^>]+Joomla/i },
  { name: "TYPO3", html: /<meta[^>]+generator[^>]+TYPO3|\/typo3(?:conf|temp)\//i },
  { name: "Ghost", html: /<meta[^>]+generator[^>]+Ghost/i },
  { name: "HubSpot CMS", html: /<meta[^>]+generator[^>]+HubSpot/i },
  { name: "Framer", html: /framerusercontent\.com/i },
  { name: "Jimdo", html: /assets\.jimstatic\.com/i },
  // e-commerce
  { name: "WooCommerce", html: /\/plugins\/woocommerce\/|woocommerce-no-js/i },
  { name: "Magento", html: /\/static\/version\d+\/frontend\/|Mage\.Cookies|text\/x-magento-init/i },
  { name: "BigCommerce", html: /cdn\d*\.bigcommerce\.com/i },
  { name: "PrestaShop", html: /<meta[^>]+generator[^>]+PrestaShop|var prestashop\b/i },
  { name: "Shopware", html: /\/bundles\/storefront\/|\/engine\/Shopware\//i },
  // analytics / tag managers
  { name: "Google Analytics", html: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(?:analytics|ga)\.js|\bgtag\(\s*['"]config['"]/i },
  { name: "Google Tag Manager", html: /googletagmanager\.com\/(?:gtm\.js|ns\.html)/i },
  { name: "Matomo", html: /matomo\.(?:js|php)|piwik\.(?:js|php)/i },
  { name: "Plausible", html: /plausible\.io\/js\//i },
  { name: "Hotjar", html: /static\.hotjar\.com/i },
  { name: "Segment", html: /cdn\.segment\.com\/analytics\.js/i },
  { name: "Mixpanel", html: /cdn\.mxpnl\.com|mixpanel\.init/i },
  { name: "Meta Pixel", html: /connect\.facebook\.net\/[^"']+\/fbevents\.js/i },
  { name: "LinkedIn Insight", html: /snap\.licdn\.com\/li\.lms-analytics/i },
  { name: "Microsoft Clarity", html: /clarity\.ms\/tag\//i },
  // chat / support
  { name: "Intercom", html: /widget\.intercom\.io|intercomSettings/i },
  { name: "Drift", html: /js\.driftt\.com/i },
  { name: "Zendesk", html: /static\.zdassets\.com/i },
  { name: "Crisp", html: /client\.crisp\.chat/i },
  { name: "Tawk.to", html: /embed\.tawk\.to/i },
  { name: "LiveChat", html: /cdn\.livechatinc\.com/i },
  { name: "Tidio", html: /code\.tidio\.co/i },
  // CRM / marketing
  { name: "HubSpot", html: /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net/i },
  { name: "Salesforce Pardot", html: /pi\.pardot\.com|pardot\.com\/pd\.js/i },
  { name: "Marketo", html: /munchkin\.marketo\.net/i },
  { name: "Mailchimp", html: /chimpstatic\.com|list-manage\.com/i },
  { name: "Klaviyo", html: /static\.klaviyo\.com/i },
  { name: "ActiveCampaign", html: /trackcmp\.net|activehosted\.com/i },
  { name: "Brevo", html: /sibforms\.com|sendinblue\.com/i },
  { name: "Calendly", html: /assets\.calendly\.com|calendly\.com\/[a-z0-9-]+/i },
  { name: "Typeform", html: /embed\.typeform\.com/i },
  // payments
  { name: "Stripe", html: /js\.stripe\.com/i },
  { name: "PayPal", html: /paypal\.com\/sdk\/js|paypalobjects\.com/i },
  { name: "Klarna", html: /klarnaservices\.com|klarnacdn\.net/i },
  // consent
  { name: "Cookiebot", html: /consent\.cookiebot\.com/i },
  { name: "Usercentrics", html: /usercentrics\.eu/i },
  { name: "OneTrust", html: /cdn\.cookielaw\.org/i },
  // frameworks
  { name: "Next.js", html: /\/_next\/static\/|id="__NEXT_DATA__"/i, header: ["x-powered-by", /next\.js/i] },
  { name: "Nuxt", html: /\/_nuxt\/|window\.__NUXT__/i },
  { name: "React", html: /data-reactroot|react(?:-dom)?(?:\.production)?\.min\.js/i },
  { name: "Vue.js", html: /data-v-app|vue(?:\.runtime)?(?:\.global)?(?:\.prod)?(?:\.min)?\.js/i },
  { name: "Angular", html: /\bng-version="/i },
  { name: "Gatsby", html: /id="___gatsby"/i },
  { name: "jQuery", html: /jquery[.-]?\d*(?:\.\d+)*(?:\.slim)?(?:\.min)?\.js/i },
  { name: "Bootstrap", html: /bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)/i },
  // hosting / CDN
  { name: "Cloudflare", header: ["server", /cloudflare/i] },
  { name: "Vercel", header: ["server", /vercel/i] },
  { name: "Netlify", header: ["server", /netlify/i] },
  { name: "Amazon CloudFront", header: ["via", /cloudfront/i] },
  { name: "Fastly", header: ["x-served-by", /cache-/i] },
  { name: "GitHub Pages", header: ["server", /github\.com/i] },
  { name: "nginx", header: ["server", /nginx/i] },
  { name: "Apache", header: ["server", /apache/i] },
];

export function detectTech(html: string, headers: Record<string, string | string[] | undefined> = {}): string[] {
  return SIGNATURES.filter((s) => {
    const h = s.header && String(headers[s.header[0]] ?? "");
    return (s.html?.test(html) ?? false) || (h ? s.header![1].test(h) : false);
  }).map((s) => s.name);
}
