"""Offline regression for robots checks when a redirect's HTML is cached."""
from __future__ import annotations

import httpx
import pytest

from ghostleads.scraping import fetch


def test_cached_redirect_rechecks_destination_robots_before_returning_html(monkeypatch, tmp_path):
    source = "https://start.example/public"
    destination = "https://other.example/private"
    source_robots = "https://start.example/robots.txt"
    destination_robots = "https://other.example/robots.txt"
    routes = {
        source_robots: (404, {}, ""),
        source: (302, {"Location": destination}, ""),
        destination_robots: (200, {}, "User-agent: *\nAllow: /private"),
        destination: (200, {"Content-Type": "text/html"}, "<p>cached</p>"),
    }
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
    monkeypatch.setattr(fetch, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(fetch, "_robots", {})
    monkeypatch.setattr(fetch, "_pace", lambda host, delay: paced.append((host, delay)))

    assert fetch.fetch_page(source, delay=0.25) == "<p>cached</p>"
    assert fetch._cache_path(source).read_text(encoding="utf-8") == "<p>cached</p>"
    assert requests == [source_robots, source, destination_robots, destination]
    assert paced == [("start.example", 0.25)] * 2 + [("other.example", 0.25)] * 2

    # A fresh robots lookup now forbids the cached response's effective URL.
    monkeypatch.setattr(fetch, "_robots", {})
    routes[destination_robots] = (200, {}, "User-agent: *\nDisallow: /private")
    with pytest.raises(fetch.FetchError, match="robots.txt disallows fetching " + destination):
        fetch.fetch_page(source, delay=0.25)
    assert requests == [source_robots, source, destination_robots, destination,
                        source_robots, destination_robots]
    assert paced == ([("start.example", 0.25)] * 2 + [("other.example", 0.25)] * 2
                     + [("start.example", 0.25), ("other.example", 0.25)])


def test_html_only_legacy_cache_refetches_instead_of_bypassing_destination_robots(monkeypatch, tmp_path):
    source = "https://start.example/public"
    destination = "https://other.example/private"
    source_robots = "https://start.example/robots.txt"
    destination_robots = "https://other.example/robots.txt"
    requests = []
    routes = {
        source_robots: httpx.Response(404),
        source: httpx.Response(302, headers={"Location": destination}),
        destination_robots: httpx.Response(200, text="User-agent: *\nDisallow: /private"),
    }

    def respond(request):
        url = str(request.url)
        requests.append(url)
        assert url in routes, f"Unexpected request: {url}"
        return routes[url]

    client = httpx.Client
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: client(
        transport=httpx.MockTransport(respond), **kwargs))
    monkeypatch.setattr(fetch, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(fetch, "_robots", {})
    monkeypatch.setattr(fetch, "_pace", lambda host, delay: None)
    fetch._cache_path(source).write_text("<p>old cached body</p>", encoding="utf-8")

    with pytest.raises(fetch.FetchError, match="robots.txt disallows fetching " + destination):
        fetch.fetch_page(source)
    assert requests == [source_robots, source, destination_robots]
