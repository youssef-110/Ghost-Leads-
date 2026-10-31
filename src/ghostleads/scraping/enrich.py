"""Resolve bare domains and extract literal contact details from Impressum pages."""
from __future__ import annotations

import os
import re
import time
from urllib.parse import urlparse, urlunparse

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel

from .fetch import fetch_page

_SERPER_LAST_REQUEST = 0.0


class ContactExtraction(BaseModel):
    owner_name: str | None = None
    owner_name_evidence: str | None = None
    owner_title: str | None = None
    owner_title_evidence: str | None = None
    owner_email: str | None = None
    owner_email_evidence: str | None = None
    owner_phone: str | None = None
    owner_phone_evidence: str | None = None


def bare_domain(url: str | None) -> str | None:
    if not url:
        return None
    value = url if "://" in url else "https://" + url
    host = (urlparse(value).hostname or "").lower().removeprefix("www.").rstrip(".")
    parts = host.split(".")
    if len(parts) >= 3 and parts[0] in {
        "us", "eu", "uk", "de", "fr", "ca", "au", "apac", "portal", "news",
        "events", "documentation", "docs", "semiconductor",
    }:
        host = ".".join(parts[1:])
    return host or None


def resolve_domain(
    company_name: str,
    *,
    event_name: str | None = None,
    serper_api_key: str | None = None,
) -> str | None:
    """Resolve a company domain from relevant Serper results, skipping ambiguous matches."""
    load_dotenv()
    key = serper_api_key or os.getenv("SERPER_API_KEY")
    if not key:
        return None
    import httpx
    excluded = {
        "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com",
        "youtube.com", "wikipedia.org", "crunchbase.com", "cloudfest.com",
        "google.com", "bing.com",
    }
    company_tokens = [part for part in re.findall(r"[a-z0-9]+", company_name.lower()) if len(part) > 2]
    if not company_tokens:
        return None
    search_name = company_name
    queries = []
    if event_name:
        event_word = event_name.split()[0]
        queries.append(f'{search_name} at {event_word} official website')
    queries.append(f'{search_name} official website')

    global _SERPER_LAST_REQUEST
    for query in queries:
        candidates: dict[str, tuple[int, str]] = {}
        wait = 1.0 - (time.monotonic() - _SERPER_LAST_REQUEST)
        if wait > 0:
            time.sleep(wait)
        response = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": key, "Content-Type": "application/json"},
            json={"q": query, "num": 10}, timeout=20,
        )
        _SERPER_LAST_REQUEST = time.monotonic()
        response.raise_for_status()
        for rank, result in enumerate(response.json().get("organic", [])):
            domain = bare_domain(result.get("link"))
            if not domain or any(domain == d or domain.endswith("." + d) for d in excluded):
                continue
            if domain.split(".")[0] in {
                "careers", "jobs", "support", "help", "docs", "documentation", "blog",
                "shop", "store", "news", "portal", "events",
            }:
                continue
            title = (result.get("title") or "").lower()
            host = domain.split(":")[0]
            title_words = set(re.findall(r"[a-z0-9]+", title))
            host_words = set(re.findall(r"[a-z0-9]+", host))
            title_hits = sum(token in title_words for token in company_tokens)
            host_hits = sum(token in host_words for token in company_tokens)
            if not title_hits and not host_hits:
                continue
            host_label = host.split(".")[0]
            joined_name = "".join(company_tokens)
            host_alias_match = host_label.startswith(joined_name) and len(host_label) - len(joined_name) >= 3
            if not host_hits and not host_alias_match:
                continue
            # Penalize clear same-name collisions, e.g. Ampere electric scooters or
            # Arrow apparel. Event-specific evidence gets more weight than raw rank.
            text = (title + " " + (result.get("snippet") or "")).lower()
            collision = any(term in text for term in (
                "scooter", "electric vehicle", "fashion", "clothing", "trousers",
                "city of", "dragon age", "bandcamp",
            ))
            if collision:
                continue
            score = 4 * host_hits + 2 * title_hits - rank
            if host_label in company_tokens or host_label == joined_name or host_alias_match:
                score += 3
            if event_name and event_name.lower().split()[0] in text:
                score += 2
            if score > candidates.get(domain, (-1, ""))[0]:
                candidates[domain] = (score, title)
        if not candidates:
            continue
        ordered = sorted(candidates.items(), key=lambda item: item[1][0], reverse=True)
        best_domain, (best_score, _) = ordered[0]
        # A single-word brand is ambiguous; use only a strong, unique result.
        if len(company_tokens) == 1 and best_score < 4:
            continue
        if len(ordered) > 1 and best_score - ordered[1][1][0] < 2:
            continue
        return best_domain
    return None


def _candidate_impressum_urls(domain: str) -> list[str]:
    urls = []
    for scheme in ("https", "http"):
        for path in ("/impressum", "/kontakt", "/imprint"):
            urls.append(urlunparse((scheme, domain, path, "", "", "")))
    return urls


def extract_impressum(domain: str) -> tuple[str | None, dict[str, str | None]]:
    """Fetch likely legal/contact pages and accept only values quoted on the page."""
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is missing; set it in the local .env file")
    found_url, page_text = None, ""
    for url in _candidate_impressum_urls(domain):
        try:
            html = fetch_page(url, timeout=8.0)
        except Exception:
            continue
        soup = BeautifulSoup(html, "html.parser")
        for node in soup(["script", "style", "noscript", "svg"]):
            node.decompose()
        text = "\n".join(s.strip() for s in soup.stripped_strings)
        if len(text) > 80:
            found_url, page_text = url, text[:30000]
            break
    if not found_url:
        return None, {key: None for key in ("owner_name", "owner_title", "owner_email", "owner_phone")}
    response = OpenAI().responses.parse(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        input=[
            {"role": "system", "content": (
                "Extract the legally responsible owner/representative and contact details. "
                "Only return a value if it appears literally in the supplied page text. For each "
                "value include an exact evidence substring copied from the text; otherwise return null. "
                "Do not treat an arbitrary staff member as owner."
            )},
            {"role": "user", "content": page_text},
        ], text_format=ContactExtraction,
    )
    item = response.output_parsed
    fields = {}
    for name in ("owner_name", "owner_title", "owner_email", "owner_phone"):
        value = getattr(item, name, None) if item else None
        evidence = getattr(item, name + "_evidence", None) if item else None
        fields[name] = value if value and evidence and evidence in page_text else None
    return found_url, fields
