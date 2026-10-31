"""Generic event-page adapter using an OpenAI structured extraction."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field

from .fetch import fetch_page


class CompanyItem(BaseModel):
    company_name: str
    website_url: str | None = None
    participant_type: str = Field(description="exhibitor, speaker, sponsor, or other")


class EventExtraction(BaseModel):
    companies: list[CompanyItem]


@dataclass(frozen=True)
class Exhibitor:
    company_name: str
    website_url: str | None
    source_url: str
    participant_type: str


def _page_material(html: str, page_url: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    for node in soup(["script", "style", "noscript", "svg"]):
        node.decompose()
    text = "\n".join(s.strip() for s in soup.stripped_strings)
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(page_url, a["href"].strip())
        if urlparse(href).scheme in ("http", "https"):
            label = " ".join(a.stripped_strings)
            links.append({"label": label[:180], "url": href})
    # Keep prompts bounded while retaining visible content and link targets.
    return text[:60000], links[:1500]


def extract_event_page(page_url: str, *, event_url: str | None = None) -> list[Exhibitor]:
    """Extract named public participants; every returned row cites the fetched page."""
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is missing; set it in the local .env file")
    html = fetch_page(page_url)
    text, links = _page_material(html, page_url)
    client = OpenAI()
    response = client.responses.parse(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        input=[
            {"role": "system", "content": (
                "Extract companies explicitly presented on this public event page as exhibitors, "
                "speakers, or sponsors. Do not infer or invent companies. Use only URLs from the "
                "provided link list as website_url; choose a company's own official website link, "
                "not social media or event links. If no clearly associated website exists, use null. "
                "Return an empty list when no participants are identifiable."
            )},
            {"role": "user", "content": "PAGE URL: " + page_url + "\nVISIBLE PAGE TEXT:\n" + text +
             "\nLINKS (JSON):\n" + json.dumps(links, ensure_ascii=False)},
        ],
        text_format=EventExtraction,
    )
    parsed = response.output_parsed
    if parsed is None:
        raise RuntimeError("OpenAI returned no structured event extraction")
    allowed = {item["url"] for item in links}
    rows = []
    seen: set[str] = set()
    for company in parsed.companies:
        name = " ".join(company.company_name.split())
        if not name or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        website = company.website_url if company.website_url in allowed else None
        rows.append(Exhibitor(name, website, page_url, company.participant_type))
    return rows
