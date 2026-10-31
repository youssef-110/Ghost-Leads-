"""Resolve bare domains and extract literal contact details from Impressum pages."""
from __future__ import annotations

import os
from urllib.parse import urlparse, urlunparse

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel

from .fetch import fetch_page


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
    return host or None


def resolve_domain(company_name: str, *, serper_api_key: str | None = None) -> str | None:
    """Use Serper's public search results for a company that had no event-page link."""
    load_dotenv()
    key = serper_api_key or os.getenv("SERPER_API_KEY")
    if not key:
        return None
    import httpx
    response = httpx.post(
        "https://google.serper.dev/search",
        headers={"X-API-KEY": key, "Content-Type": "application/json"},
        json={"q": f"{company_name} official website"}, timeout=20,
    )
    response.raise_for_status()
    for result in response.json().get("organic", []):
        domain = bare_domain(result.get("link"))
        if domain:
            return domain
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
            html = fetch_page(url)
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
