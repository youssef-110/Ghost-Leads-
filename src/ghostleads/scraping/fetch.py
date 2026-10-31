"""Polite public-page fetching with robots.txt checks, caching, and host pacing."""
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
import httpx

USER_AGENT = "GhostLeadsResearchBot/0.1 (+public event/company pages)"
CACHE_DIR = Path("data/cache")
_last_request: dict[str, float] = {}
_robots: dict[str, RobotFileParser] = {}


class FetchError(RuntimeError):
    pass


def _cache_path(url: str) -> Path:
    return CACHE_DIR / (hashlib.sha256(url.encode("utf-8")).hexdigest() + ".html")


def _rendered_cache_path(url: str) -> Path:
    return CACHE_DIR / (hashlib.sha256(url.encode("utf-8")).hexdigest() + ".rendered.html")


def _looks_like_javascript_shell(html: str) -> bool:
    soup = BeautifulSoup(html, "html.parser")
    for node in soup(("script", "style", "noscript", "svg")):
        node.decompose()
    text = " ".join(soup.stripped_strings)
    script_srcs = [node.get("src", "") for node in BeautifulSoup(html, "html.parser").find_all("script")]
    framework_app = (
        any("/_next/" in src or "react" in src.lower() for src in script_srcs)
        or soup.find(id="__next") is not None
        or soup.find(id="root") is not None
    )
    return framework_app and (len(text) < 6000 or len(text) / max(1, len(html)) < 0.04)


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


def _fetch_rendered_page(url: str, *, delay: float, use_cache: bool) -> str:
    """Render a JavaScript-heavy public page after applying the same crawl rules."""
    parsed = urlparse(url)
    cached_path = _rendered_cache_path(url)
    headers = {"User-Agent": USER_AGENT}
    try:
        with httpx.Client(headers=headers, timeout=25, follow_redirects=True) as client:
            robots = _robot_parser(url, client, delay)
            if not robots.can_fetch(USER_AGENT, url):
                raise FetchError(f"robots.txt disallows fetching {url}")
            if use_cache and cached_path.exists():
                return cached_path.read_text(encoding="utf-8")

            try:
                from playwright.sync_api import Error as PlaywrightError
                from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
                from playwright.sync_api import sync_playwright
            except ImportError as exc:
                raise FetchError(
                    "This public page needs JavaScript rendering; install Playwright and Chromium"
                ) from exc

            with sync_playwright() as playwright:
                try:
                    browser = playwright.chromium.launch(headless=True)
                except PlaywrightError:
                    try:
                        browser = playwright.chromium.launch(channel="msedge", headless=True)
                    except PlaywrightError as exc:
                        raise FetchError(
                            "Install a Playwright Chromium browser with `python -m playwright install chromium`"
                        ) from exc
                context = browser.new_context(user_agent=USER_AGENT)
                page = context.new_page()

                def handle_route(route):
                    request = route.request
                    request_url = urlparse(request.url)
                    if request_url.scheme not in ("http", "https") or request_url.netloc != parsed.netloc:
                        route.abort()
                        return
                    if request.resource_type in {"image", "font", "media", "websocket"}:
                        route.abort()
                        return
                    request_robots = _robot_parser(request.url, client, delay)
                    if not request_robots.can_fetch(USER_AGENT, request.url):
                        route.abort()
                        return
                    _pace(request_url.netloc, delay)
                    route.continue_()

                page.route("**/*", handle_route)
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                try:
                    page.wait_for_load_state("networkidle", timeout=10000)
                except PlaywrightTimeoutError:
                    pass
                body = page.content()
                browser.close()
    except FetchError:
        raise
    except Exception as exc:
        raise FetchError(f"Could not render {url}: {exc}") from exc

    cached_path.parent.mkdir(parents=True, exist_ok=True)
    cached_path.write_text(body, encoding="utf-8")
    return body


def fetch_page(
    url: str,
    *,
    delay: float = 1.0,
    use_cache: bool = True,
    render_if_needed: bool = False,
    timeout: float = 25.0,
) -> str:
    """Fetch a public HTML page; render a thin JavaScript shell only when requested."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise FetchError(f"Expected an http(s) URL, got {url!r}")
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    try:
        with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
            robots = _robot_parser(url, client, delay)
            if not robots.can_fetch(USER_AGENT, url):
                raise FetchError(f"robots.txt disallows fetching {url}")
            path = _cache_path(url)
            if use_cache and path.exists():
                body = path.read_text(encoding="utf-8")
            else:
                _pace(parsed.netloc, delay)
                response = client.get(url)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if content_type and not any(t in content_type.lower() for t in ("text/html", "application/xhtml")):
                    raise FetchError(f"Skipping non-HTML page {url} ({content_type})")
                body = response.text
    except httpx.HTTPError as exc:
        raise FetchError(f"Could not fetch {url}: {exc}") from exc
    if not (use_cache and path.exists()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    if render_if_needed and _looks_like_javascript_shell(body):
        return _fetch_rendered_page(url, delay=delay, use_cache=use_cache)
    return body
