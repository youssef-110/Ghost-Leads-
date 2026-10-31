"""Polite public-page fetching with robots.txt checks, caching, and host pacing."""
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

USER_AGENT = "GhostLeadsResearchBot/0.1 (+public event/company pages)"
CACHE_DIR = Path("data/cache")
_last_request: dict[str, float] = {}
_robots: dict[str, RobotFileParser] = {}


class FetchError(RuntimeError):
    pass


def _cache_path(url: str) -> Path:
    return CACHE_DIR / (hashlib.sha256(url.encode("utf-8")).hexdigest() + ".html")


def _pace(host: str, delay: float) -> None:
    wait = delay - (time.monotonic() - _last_request.get(host, 0.0))
    if wait > 0:
        time.sleep(wait)
    _last_request[host] = time.monotonic()


def _robot_parser(url: str, client: httpx.Client, delay: float) -> RobotFileParser:
    parts = urlparse(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in _robots:
        robots_url = origin + "/robots.txt"
        parser = RobotFileParser(robots_url)
        try:
            _pace(parts.netloc, delay)
            response = client.get(robots_url)
            if response.status_code == 200:
                parser.parse(response.text.splitlines())
            else:
                # A missing robots.txt imposes no published restrictions.
                parser.parse([])
        except httpx.HTTPError as exc:
            raise FetchError(f"Could not check robots.txt for {origin}: {exc}") from exc
        _robots[origin] = parser
    return _robots[origin]


def fetch_page(url: str, *, delay: float = 1.0, use_cache: bool = True) -> str:
    """Fetch a public HTML page; cached content is reused only after robots check."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise FetchError(f"Expected an http(s) URL, got {url!r}")
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    try:
        with httpx.Client(headers=headers, timeout=25, follow_redirects=True) as client:
            robots = _robot_parser(url, client, delay)
            if not robots.can_fetch(USER_AGENT, url):
                raise FetchError(f"robots.txt disallows fetching {url}")
            path = _cache_path(url)
            if use_cache and path.exists():
                return path.read_text(encoding="utf-8")
            _pace(parsed.netloc, delay)
            response = client.get(url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if content_type and not any(t in content_type.lower() for t in ("text/html", "application/xhtml")):
                raise FetchError(f"Skipping non-HTML page {url} ({content_type})")
            body = response.text
    except httpx.HTTPError as exc:
        raise FetchError(f"Could not fetch {url}: {exc}") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return body
