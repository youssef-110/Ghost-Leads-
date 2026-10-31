"""Deterministic adapter for the public, embedded IT.CON 2026 exhibitor guide.

The marketing page embeds Fairdesigner rather than rendering exhibitors in its HTML.
The public bootstrapper points to /catalog/embedded/entries and /entry/<contractid>;
the live guide publishes tenant CCS, tenant number 10125 and event 5042026.
Fail closed if these identifiers or the guide format change instead of returning zero
or asking a model to infer companies from unrelated marketing text.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urlparse

from bs4 import BeautifulSoup

from .fetch import fetch_page

_SOURCE_HOSTS = {"it-con-messe.de", "www.it-con-messe.de"}
_GUIDE_HOST = "exhibitorlist-2-5.fairdesigner.de"
_GUIDE_BASE = f"https://{_GUIDE_HOST}/catalog/embedded"
_TENANT_NO = "10125"
_TENANT = "CCS"
_BOOTSTRAP_TENANT = "Saarmesse"  # public embed differs from guide API tenant
_EVENT_ID = "5042026"
_PAGE_SIZE = 50
_MAX_PAGES = 100
_PUBLISHED_CARDS = 124  # 123 exhibitors plus one administrative test card
_TEST_CARD = ("A000015190", "TEST AUFTRAG TICKETANLAGE")
_CONTRACT_ID = re.compile(r"A[0-9]+")


class ITConExtractionError(RuntimeError):
    """Public exhibitor guide changed or is incomplete; do not claim zero leads."""


def is_itcon_exhibitor_page(url: str) -> bool:
    parsed = urlparse(url)
    return (parsed.scheme in {"http", "https"} and
            parsed.hostname in _SOURCE_HOSTS and
            parsed.path.rstrip("/") == "/die-messe/aussteller")


def is_itcon_source(url: str) -> bool:
    """A source on this host must not silently fall back to model extraction."""
    parsed = urlparse(url)
    return parsed.hostname in _SOURCE_HOSTS


def _clean(value: str) -> str:
    return " ".join(value.split())


def _verify_embed(html: str) -> None:
    tag = BeautifulSoup(html, "html.parser").select_one('script[data-id="exhibitorlist"]')
    if tag is None:
        raise ITConExtractionError("IT.CON exhibitor embed is missing from the event page")
    main = urlparse(tag.get("data-main", ""))
    if (main.scheme != "https" or main.hostname != _GUIDE_HOST or
            main.path != "/catalog/bootstrapper.js" or
            main.netloc != _GUIDE_HOST or
            parse_qs(main.query, keep_blank_values=True) != {
                "tenantnr": [_TENANT_NO], "tenant": [_BOOTSTRAP_TENANT]} or
            tag.get("data-tenantno") != _TENANT_NO or
            tag.get("data-eventid") != _EVENT_ID or
            tag.get("data-language") != "de"):
        raise ITConExtractionError("IT.CON exhibitor embed/event identifiers changed")


def _guide_url(path: str, *, page: int | None = None) -> str:
    params = {"tenantnr": _TENANT_NO, "tenant": _TENANT, "eventid": _EVENT_ID,
              "language": "de"}
    if page is not None:
        params.update({"page": str(page), "layout": "liste",
                       "entries_per_page": str(_PAGE_SIZE)})
    return f"{_GUIDE_BASE}/{path}?{urlencode(params)}"


def _parse_listing(html: str, page: int) -> tuple[int, list[tuple[str, str]]]:
    soup = BeautifulSoup(html, "html.parser")
    catalog = soup.select_one("#catalog")
    if catalog is None:
        raise ITConExtractionError(f"IT.CON guide page {page} has no catalog")
    page_counts = [int(match.group(1)) for span in catalog.select("span")
                   if (match := re.fullmatch(r"von\s+(\d+)", span.get_text(" ", strip=True)))]
    if not page_counts or len(set(page_counts)) != 1 or not 1 <= page_counts[0] <= _MAX_PAGES:
        raise ITConExtractionError(f"IT.CON guide page {page} has invalid pagination")
    rows = []
    seen = set()
    for card in catalog.select("exhibitorlist-list-item"):
        identifier = card.get("id", "")
        name = _clean(card.get("title", ""))
        heading = card.select_one("h5")
        if (not _CONTRACT_ID.fullmatch(identifier) or not name or
                heading is None or _clean(heading.get_text(" ", strip=True)) != name):
            raise ITConExtractionError(f"IT.CON guide page {page} has an invalid exhibitor card")
        if identifier in seen:
            raise ITConExtractionError(f"IT.CON guide page {page} has duplicate exhibitor IDs")
        seen.add(identifier)
        rows.append((identifier, name))
    if not rows or len(rows) > _PAGE_SIZE:
        raise ITConExtractionError(f"IT.CON guide page {page} is empty or oversized")
    if page < page_counts[0] and len(rows) != _PAGE_SIZE:
        raise ITConExtractionError(f"IT.CON guide page {page} is short before the final page")
    return page_counts[0], rows


def _website_from_detail(html: str, identifier: str, name: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    catalog = soup.select_one("#catalog")
    title = catalog.select_one(".card-content.white-text .card-title") if catalog else None
    cards = catalog.find_all(id=identifier) if catalog else []
    if (title is None or _clean(title.get_text(" ", strip=True)) != name or
            len(cards) != 1):
        raise ITConExtractionError(f"IT.CON detail mismatch for {identifier}")
    link = cards[0].select_one("a.link.internet[href]")
    if link is None:
        return None
    href = link["href"].strip()
    parsed = urlparse(href)
    return href if parsed.scheme in {"http", "https"} and parsed.hostname else None


def extract_itcon_exhibitors(page_url: str) -> list["Exhibitor"]:
    """Read every published exhibitor and its own linked site, without inference."""
    from .adapter import Exhibitor  # imported at call time to avoid a module cycle

    # A cached listing can assert an obsolete published count; robots and host
    # pacing still apply to these fresh requests via fetch_page.
    _verify_embed(fetch_page(page_url, use_cache=False))
    first_count, first_rows = _parse_listing(fetch_page(_guide_url("entries", page=1), use_cache=False), 1)
    expected_pages = (_PUBLISHED_CARDS + _PAGE_SIZE - 1) // _PAGE_SIZE
    if first_count != expected_pages:
        raise ITConExtractionError("IT.CON guide published page count changed")
    cards = list(first_rows)
    seen = {identifier for identifier, _ in cards}
    for page in range(2, first_count + 1):
        page_count, rows = _parse_listing(fetch_page(_guide_url("entries", page=page), use_cache=False), page)
        if page_count != first_count or any(identifier in seen for identifier, _ in rows):
            raise ITConExtractionError(f"IT.CON guide pagination changed on page {page}")
        cards.extend(rows)
        seen.update(identifier for identifier, _ in rows)

    if len(cards) != _PUBLISHED_CARDS:
        raise ITConExtractionError(f"IT.CON guide published total changed: {len(cards)} cards")

    # The live guide exposes an administrative ticket-order test as a card.
    # Its linked site belongs to the organizer, not to an exhibitor.
    if cards.count(_TEST_CARD) != 1:
        raise ITConExtractionError("IT.CON guide published test-card count changed")
    cards = [card for card in cards if card != _TEST_CARD]
    if not cards:
        raise ITConExtractionError("IT.CON guide has no genuine exhibitor cards")

    exhibitors = []
    for identifier, name in cards:
        detail_url = _guide_url(f"entry/{identifier}")
        website = _website_from_detail(fetch_page(detail_url), identifier, name)
        exhibitors.append(Exhibitor(name, website, detail_url, "exhibitor"))
    return exhibitors
