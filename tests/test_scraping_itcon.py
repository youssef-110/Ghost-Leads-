"""Offline contract tests for the published IT.CON guide (124 cards, 123 real)."""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from ghostleads.scraping import adapter, fetch, itcon


EVENT_URL = "https://it-con-messe.de/die-messe/aussteller"
EMBED = """<script data-id="exhibitorlist" data-tenantno="10125"
 data-eventid="5042026" data-language="de"
 data-main="https://exhibitorlist-2-5.fairdesigner.de/catalog/bootstrapper.js?tenantnr=10125&amp;tenant=Saarmesse"></script>"""
TEST_CARD = ("A000015190", "TEST AUFTRAG TICKETANLAGE")
CARDS = [(f"A{index:09d}", f"Firm {index:03d}") for index in range(123)] + [TEST_CARD]


def listing(*items: tuple[str, str], pages: int = 3) -> str:
    cards = "".join(
        f'<exhibitorlist-list-item id="{identifier}" title="{name}">'
        f"<h5>{name}</h5></exhibitorlist-list-item>"
        for identifier, name in items
    )
    return f'<div id="catalog">{cards}<span>von {pages}</span></div>'


def detail(identifier: str, name: str, href: str | None) -> str:
    link = f'<a class="link internet" href="{href}">Internet</a>' if href else ""
    return (f'<div id="catalog"><div class="card-content white-text">'
            f'<span class="card-title">{name}</span></div>'
            f'<div id="{identifier}">{link}</div></div>')


def offline_guide(monkeypatch, *, pages=None):
    """Complete synthetic guide with no network and no missing detail pages."""
    pages = pages if pages is not None else [CARDS[:50], CARDS[50:100], CARDS[100:]]
    requests = []
    by_id = dict(CARDS)

    def fake_fetch(url, **kwargs):
        requests.append((url, kwargs))
        if url == EVENT_URL:
            return EMBED
        parsed = urlparse(url)
        assert parsed.hostname == "exhibitorlist-2-5.fairdesigner.de"
        params = parse_qs(parsed.query)
        assert params["tenantnr"] == ["10125"]
        assert params["tenant"] == ["CCS"]
        assert params["eventid"] == ["5042026"]
        if parsed.path.endswith("/entries"):
            assert params["entries_per_page"] == ["50"]
            return listing(*pages[int(params["page"][0]) - 1], pages=len(pages))
        identifier = parsed.path.rsplit("/", 1)[-1]
        assert identifier != TEST_CARD[0], "Administrative test card must not get a detail request"
        return detail(identifier, by_id[identifier],
                      "https://firm.example/" if identifier == CARDS[0][0] else None)

    monkeypatch.setattr(itcon, "fetch_page", fake_fetch)
    return requests


def test_itcon_dispatch_fetches_complete_guide_without_openai_or_stale_listing(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    requests = offline_guide(monkeypatch)
    rows = adapter.extract_event_page(EVENT_URL, event_url=EVENT_URL)
    assert len(rows) == 123
    assert [r.company_name for r in rows] == [name for _, name in CARDS[:-1]]
    assert rows[0].website_url == "https://firm.example/"
    assert all(r.participant_type == "exhibitor" for r in rows)
    assert all(r.source_url.startswith("https://exhibitorlist-2-5.fairdesigner.de/catalog/embedded/entry/") for r in rows)
    assert len(requests) == 127  # event, three list pages, 123 detail pages
    assert all(kwargs.get("use_cache") is False for url, kwargs in requests
               if url == EVENT_URL or "/entries?" in url)


@pytest.mark.parametrize("source", ["<h1>Aussteller</h1>", EMBED.replace('data-eventid="5042026"', 'data-eventid="5042025"')])
def test_itcon_does_not_fall_back_to_inventing_exhibitors(monkeypatch, source):
    monkeypatch.setattr(itcon, "fetch_page", lambda url, **kw: source if url == EVENT_URL else pytest.fail(url))
    with pytest.raises(itcon.ITConExtractionError, match="embed|event"):
        adapter.extract_event_page(EVENT_URL)


@pytest.mark.parametrize("changed", [
    EMBED.replace("tenantnr=10125", "tenantnr=99999"),
    EMBED.replace("tenant=Saarmesse", "tenant=Other"),
    EMBED.replace("tenant=Saarmesse", "tenant=CCS"),
    EMBED.replace("tenant=Saarmesse", "tenant=Saarmesse&amp;tenant=Other"),
])
def test_bootstrap_query_must_match_published_tenant(monkeypatch, changed):
    monkeypatch.setattr(itcon, "fetch_page", lambda url, **kw: changed if url == EVENT_URL else pytest.fail(url))
    with pytest.raises(itcon.ITConExtractionError, match="identifiers"):
        adapter.extract_event_page(EVENT_URL)


@pytest.mark.parametrize("page_url,event_url", [
    ("https://it-con-messe.de/die-messe/aussteller-2026", None),
    ("https://it-con-messe.de/die-messe/teilnehmer", EVENT_URL),
    ("https://example.com/other", EVENT_URL),
    (EVENT_URL, "https://it-con-messe.de/die-messe/aussteller-2027"),
])
def test_itcon_path_changes_or_event_url_mismatch_never_use_generic_openai(monkeypatch, page_url, event_url):
    monkeypatch.setattr(adapter, "fetch_page", lambda url: pytest.fail("generic fetch attempted"))
    monkeypatch.setattr(adapter, "OpenAI", lambda: pytest.fail("generic OpenAI attempted"))
    with pytest.raises(itcon.ITConExtractionError, match="path|source"):
        adapter.extract_event_page(page_url, event_url=event_url)


def test_itcon_empty_listing_is_an_error_not_a_zero_result():
    with pytest.raises(itcon.ITConExtractionError, match="empty"):
        itcon._parse_listing(listing(), 1)


def test_short_nonfinal_page_is_rejected_before_detail_fetch(monkeypatch):
    requests = offline_guide(monkeypatch, pages=[CARDS[:49], CARDS[49:100], CARDS[100:]])
    with pytest.raises(itcon.ITConExtractionError, match="short|incomplete"):
        adapter.extract_event_page(EVENT_URL)
    assert not any("/entry/" in url for url, _ in requests)


def test_duplicate_ids_within_one_page_are_rejected():
    with pytest.raises(itcon.ITConExtractionError, match="duplicate"):
        itcon._parse_listing(listing(CARDS[0], CARDS[0]), 1)


def test_listing_does_not_accept_pagination_or_cards_outside_catalog():
    ident, name = CARDS[0]
    unrelated = (f'<exhibitorlist-list-item id="{ident}" title="{name}">'
                 f'<h5>{name}</h5></exhibitorlist-list-item>')
    with pytest.raises(itcon.ITConExtractionError, match="pagination"):
        itcon._parse_listing(f'<span>von 3</span><div id="catalog">{unrelated}</div>', 1)
    with pytest.raises(itcon.ITConExtractionError, match="empty"):
        itcon._parse_listing(f'{unrelated}<div id="catalog"><span>von 1</span></div>', 1)


def test_duplicate_ids_across_pages_are_rejected_before_detail_fetch(monkeypatch):
    requests = offline_guide(monkeypatch, pages=[CARDS[:50], CARDS[49:99], CARDS[100:]])
    with pytest.raises(itcon.ITConExtractionError, match="pagination|duplicate"):
        adapter.extract_event_page(EVENT_URL)
    assert not any("/entry/" in url for url, _ in requests)


def test_published_total_mismatch_is_error_not_plausible_partial_result(monkeypatch):
    requests = offline_guide(monkeypatch, pages=[CARDS[:50], CARDS[50:100], CARDS[100:-1]])
    with pytest.raises(itcon.ITConExtractionError, match="total|count"):
        adapter.extract_event_page(EVENT_URL)
    assert not any("/entry/" in url for url, _ in requests)


def test_inconsistent_page_count_is_rejected(monkeypatch):
    requests = offline_guide(monkeypatch)
    original = itcon.fetch_page

    def changed_count(url, **kwargs):
        if "page=2" in url:
            return listing(*CARDS[50:100], pages=4)
        return original(url, **kwargs)

    monkeypatch.setattr(itcon, "fetch_page", changed_count)
    with pytest.raises(itcon.ITConExtractionError, match="pagination"):
        adapter.extract_event_page(EVENT_URL)
    assert not any("/entry/" in url for url, _ in requests)


def test_website_is_scoped_to_matching_detail_card_not_organizer():
    identifier, name = CARDS[0]
    html = (f'<div id="catalog"><div class="card-content white-text"><span class="card-title">{name}</span></div>'
            '<a class="link internet" href="https://organizer.example/">Organizer</a>'
            f'<div id="{identifier}"><a class="link internet" href="https://company.example/">Company</a></div></div>')
    assert itcon._website_from_detail(html, identifier, name) == "https://company.example/"
    assert itcon._website_from_detail(html.replace(' href="https://company.example/"', ''), identifier, name) is None


def test_itcon_detail_must_match_listed_company():
    identifier, name = CARDS[0]
    with pytest.raises(itcon.ITConExtractionError, match="mismatch"):
        itcon._website_from_detail(detail(identifier, "Different GmbH", "https://different.example/"), identifier, name)


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_robots_denial_or_failure_must_not_be_treated_as_permission(monkeypatch, status):
    monkeypatch.setattr(fetch, "_robots", {})
    paced = []
    monkeypatch.setattr(fetch, "_pace", lambda host, delay: paced.append((host, delay)))

    class Client:
        def get(self, url):
            assert url == "https://exhibitorlist-2-5.fairdesigner.de/robots.txt"
            return type("Response", (), {"status_code": status})()

    with pytest.raises(fetch.FetchError, match="robots.txt"):
        fetch._robot_parser(itcon._guide_url("entries", page=1), Client(), 1.0)
    assert paced == [("exhibitorlist-2-5.fairdesigner.de", 1.0)]


def test_missing_robots_file_allows_paced_fetch(monkeypatch):
    monkeypatch.setattr(fetch, "_robots", {})
    paced = []
    monkeypatch.setattr(fetch, "_pace", lambda host, delay: paced.append((host, delay)))

    class Client:
        def get(self, url):
            return type("Response", (), {"status_code": 404})()

    url = itcon._guide_url("entries", page=1)
    assert fetch._robot_parser(url, Client(), 1.0).can_fetch(fetch.USER_AGENT, url)
    assert paced == [("exhibitorlist-2-5.fairdesigner.de", 1.0)]


@pytest.fixture
def offline_fetch(monkeypatch, tmp_path):
    """Drive the real fetcher through an isolated HTTP transport, never the network."""
    routes = {}
    requests = []
    paced = []

    def respond(request):
        url = str(request.url)
        requests.append(url)
        assert url in routes, f"Unexpected request: {url}"
        status, headers, body = routes[url]
        return httpx.Response(status, headers=headers, text=body)

    client = httpx.Client
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: client(
        transport=httpx.MockTransport(respond), **kwargs))
    monkeypatch.setattr(fetch, "_robots", {})
    monkeypatch.setattr(fetch, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(fetch, "_pace", lambda host, delay: paced.append((host, delay)))
    return routes, requests, paced


def test_same_host_redirect_denied_before_request(offline_fetch):
    routes, requests, paced = offline_fetch
    start = "https://start.example/public"
    private = "https://start.example/private"
    routes.update({
        "https://start.example/robots.txt": (200, {}, "User-agent: *\nDisallow: /private"),
        start: (302, {"Location": "/private"}, ""),
        private: (200, {"Content-Type": "text/html"}, "secret"),
    })
    with pytest.raises(fetch.FetchError, match="robots.txt disallows"):
        fetch.fetch_page(start, delay=0.25)
    assert requests == ["https://start.example/robots.txt", start]
    assert paced == [("start.example", 0.25), ("start.example", 0.25)]
    assert not fetch._cache_path(start).exists()


def test_cross_host_redirect_denied_before_target_request(offline_fetch):
    routes, requests, paced = offline_fetch
    start = "https://start.example/public"
    target = "https://other.example/private"
    routes.update({
        "https://start.example/robots.txt": (404, {}, ""),
        start: (301, {"Location": target}, ""),
        "https://other.example/robots.txt": (200, {}, "User-agent: *\nDisallow: /private"),
        target: (200, {"Content-Type": "text/html"}, "secret"),
    })
    with pytest.raises(fetch.FetchError, match="robots.txt disallows"):
        fetch.fetch_page(start, delay=0.25)
    assert requests == ["https://start.example/robots.txt", start, "https://other.example/robots.txt"]
    assert paced == [("start.example", 0.25), ("start.example", 0.25),
                     ("other.example", 0.25)]
    assert not fetch._cache_path(start).exists()


@pytest.mark.parametrize("status", [401, 403, 429, 500, 302])
def test_redirect_target_robots_error_fails_closed(offline_fetch, status):
    routes, requests, _ = offline_fetch
    start = "https://start.example/public"
    target = "https://other.example/allowed"
    routes.update({
        "https://start.example/robots.txt": (404, {}, ""),
        start: (302, {"Location": target}, ""),
        "https://other.example/robots.txt": (status, {"Location": "/allowed"}, ""),
        target: (200, {"Content-Type": "text/html"}, "unverified"),
    })
    with pytest.raises(fetch.FetchError, match="robots.txt"):
        fetch.fetch_page(start)
    assert requests == ["https://start.example/robots.txt", start, "https://other.example/robots.txt"]


def test_allowed_redirects_check_each_hop_and_cache_original_url(offline_fetch):
    routes, requests, paced = offline_fetch
    start = "https://start.example/public"
    middle = "https://start.example/moved"
    destination = "https://other.example/final"
    routes.update({
        "https://start.example/robots.txt": (200, {}, "User-agent: *\nDisallow: /private"),
        start: (302, {"Location": "/moved#fragment"}, ""),
        middle: (307, {"Location": destination}, ""),
        "https://other.example/robots.txt": (200, {}, "User-agent: *\nDisallow: /private"),
        destination: (200, {"Content-Type": "text/html; charset=utf-8"}, "final body"),
    })
    assert fetch.fetch_page(start, delay=0.25) == "final body"
    assert requests == ["https://start.example/robots.txt", start, middle,
                        "https://other.example/robots.txt", destination]
    assert paced == [("start.example", 0.25)] * 3 + [("other.example", 0.25)] * 2
    assert fetch._cache_path(start).read_text(encoding="utf-8") == "final body"
    assert not fetch._cache_path(destination).exists()
    assert fetch.fetch_page(start, delay=0.25) == "final body"
    assert len(requests) == 5  # cache hit after the original URL's robots check
    assert fetch.fetch_page(start, delay=0.25, use_cache=False) == "final body"
    assert len(requests) == 8  # disabled cache refreshes all page hops


def test_cached_redirect_still_checks_original_robots(offline_fetch, monkeypatch):
    routes, requests, _ = offline_fetch
    start = "https://start.example/public"
    routes.update({
        "https://start.example/robots.txt": (404, {}, ""),
        start: (302, {"Location": "/final"}, ""),
        "https://start.example/final": (200, {"Content-Type": "text/html"}, "cached body"),
    })
    assert fetch.fetch_page(start) == "cached body"
    monkeypatch.setattr(fetch, "_robots", {})
    routes["https://start.example/robots.txt"] = (200, {}, "User-agent: *\nDisallow: /public")
    with pytest.raises(fetch.FetchError, match="robots.txt disallows"):
        fetch.fetch_page(start)
    assert requests == ["https://start.example/robots.txt", start, "https://start.example/final",
                        "https://start.example/robots.txt"]
    assert fetch._cache_path(start).read_text(encoding="utf-8") == "cached body"


def test_redirect_at_limit_is_allowed(offline_fetch, monkeypatch):
    routes, requests, _ = offline_fetch
    monkeypatch.setattr(fetch, "MAX_REDIRECTS", 2)
    base = "https://start.example/"
    routes.update({
        base + "robots.txt": (404, {}, ""),
        base + "0": (302, {"Location": "/1"}, ""),
        base + "1": (308, {"Location": "/2"}, ""),
        base + "2": (200, {"Content-Type": "text/html"}, "at limit"),
    })
    assert fetch.fetch_page(base + "0") == "at limit"
    assert requests == [base + "robots.txt", base + "0", base + "1", base + "2"]


def test_redirect_loop_fails_without_repeating_request(offline_fetch):
    routes, requests, _ = offline_fetch
    start = "https://start.example/public"
    next_url = "https://start.example/moved"
    routes.update({
        "https://start.example/robots.txt": (404, {}, ""),
        start: (302, {"Location": "/moved"}, ""),
        next_url: (302, {"Location": "/public#different-fragment"}, ""),
    })
    with pytest.raises(fetch.FetchError, match="loop"):
        fetch.fetch_page(start)
    assert requests == ["https://start.example/robots.txt", start, next_url]
    assert not fetch._cache_path(start).exists()


def test_redirect_limit_fails_without_fetching_next_hop(offline_fetch, monkeypatch):
    routes, requests, _ = offline_fetch
    monkeypatch.setattr(fetch, "MAX_REDIRECTS", 2)
    base = "https://start.example/"
    routes[base + "robots.txt"] = (404, {}, "")
    for index in range(3):
        routes[base + str(index)] = (302, {"Location": "/" + str(index + 1)}, "")
    routes[base + "3"] = (200, {"Content-Type": "text/html"}, "too far")
    with pytest.raises(fetch.FetchError, match="limit"):
        fetch.fetch_page(base + "0")
    assert requests == [base + "robots.txt", base + "0", base + "1", base + "2"]
    assert not fetch._cache_path(base + "0").exists()


@pytest.mark.parametrize("location", [None, "ftp://other.example/private", "http://[bad"])
def test_invalid_redirect_location_fails_closed(offline_fetch, location):
    routes, requests, _ = offline_fetch
    start = "https://start.example/public"
    routes["https://start.example/robots.txt"] = (404, {}, "")
    routes[start] = (302, {"Location": location} if location else {}, "")
    with pytest.raises(fetch.FetchError, match="Location|Invalid redirect"):
        fetch.fetch_page(start)
    assert requests == ["https://start.example/robots.txt", start]
