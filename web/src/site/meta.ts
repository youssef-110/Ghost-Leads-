import { useEffect } from "react";

const head = (selector: string) => document.head.querySelector(selector);

/** The public address. Its one home is the canonical link in index.html; scripts read it from there. */
export const SITE_URL = new URL(head('link[rel="canonical"]')?.getAttribute("href") ?? location.href).origin;

// What index.html ships with is the home page's title and description.
const HOME = { title: document.title, description: head('meta[name="description"]')?.getAttribute("content") ?? "" };

function apply(path: string, title: string, description: string) {
  document.title = title;
  const url = SITE_URL + path;
  const tags = [
    ['meta[name="description"]', "content", description],
    ['meta[property="og:title"]', "content", title],
    ['meta[property="og:description"]', "content", description],
    ['meta[property="og:url"]', "content", url],
    ['link[rel="canonical"]', "href", url],
  ];
  for (const [selector, attribute, value] of tags) head(selector)?.setAttribute(attribute, value);
}

/** Sets the title, description and canonical address of a public page. Leaving it puts the home values back. */
export function usePageMeta(path: string, title?: string, description?: string) {
  useEffect(() => {
    apply(path, title ? `${title} | Ghost Leads` : HOME.title, description ?? HOME.description);
    return () => apply("/", HOME.title, HOME.description);
  }, [path, title, description]);
}
