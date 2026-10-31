"""Polite public-page fetching with robots.txt checks, caching, and host pacing."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

USER_AGENT = "GhostLeadsResearchBot/0.1 (+public event/company pages)"
MAX_REDIRECTS = 10
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
            elif response.status_code in (404, 410):
                # No published restrictions only when robots.txt is actually missing.
                parser.parse([])
            else:
                raise FetchError(f"Cannot verify robots.txt for {origin}: HTTP {response.status_code}")
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
    path = _cache_path(url)
    metadata_path = path.with_suffix(".json")
    current_url = urldefrag(url).url
    seen = {current_url}
    try:
        # Never let httpx auto-follow: every hop needs its own robots and pace checks.
        with httpx.Client(headers=headers, timeout=25, follow_redirects=False) as client:
            for hop in range(MAX_REDIRECTS + 1):
                parsed = urlparse(current_url)
                robots = _robot_parser(current_url, client, delay)
                if not robots.can_fetch(USER_AGENT, current_url):
                    raise FetchError(f"robots.txt disallows fetching {current_url}")
                if hop == 0 and use_cache and path.exists():
                    # Old HTML-only caches cannot identify a redirected destination.
                    # Refetch rather than treating an unknown destination as allowed.
                    try:
                        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                        cached_body = path.read_text(encoding="utf-8")
                        final_url = metadata["final_url"]
                        valid = (isinstance(final_url, str)
                                 and urlparse(final_url).scheme in ("http", "https")
                                 and bool(urlparse(final_url).netloc)
                                 and metadata["sha256"] == hashlib.sha256(
                                     cached_body.encode("utf-8")).hexdigest())
                    except (OSError, ValueError, KeyError, TypeError):
                        valid = False
                    if valid:
                        if final_url != current_url:
                            final_robots = _robot_parser(final_url, client, delay)
                            if not final_robots.can_fetch(USER_AGENT, final_url):
                                raise FetchError(f"robots.txt disallows fetching {final_url}")
                        return cached_body
                _pace(parsed.netloc, delay)
                response = client.get(current_url)
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise FetchError(f"Redirect without Location from {current_url}")
                    if hop == MAX_REDIRECTS:
                        raise FetchError(f"Redirect limit exceeded for {url}")
                    try:
                        next_url = urldefrag(urljoin(current_url, location)).url
                        target = urlparse(next_url)
                    except ValueError as exc:
                        raise FetchError(f"Invalid redirect from {current_url}: {location!r}") from exc
                    if target.scheme not in ("http", "https") or not target.netloc:
                        raise FetchError(f"Invalid redirect from {current_url}: {location!r}")
                    if next_url in seen:
                        raise FetchError(f"Redirect loop at {next_url}")
                    seen.add(next_url)
                    current_url = next_url
                    continue
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if content_type and not any(t in content_type.lower() for t in ("text/html", "application/xhtml")):
                    raise FetchError(f"Skipping non-HTML page {current_url} ({content_type})")
                body = response.text
                break
    except httpx.HTTPError as exc:
        raise FetchError(f"Could not fetch {url}: {exc}") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    # Invalidate old metadata before replacing the HTML, including on write failure.
    metadata_path.unlink(missing_ok=True)
    path.write_text(body, encoding="utf-8")
    metadata_path.write_text(json.dumps({
        "final_url": current_url,
        "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }), encoding="utf-8")
    return body
