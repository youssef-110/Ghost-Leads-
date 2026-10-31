"""Minimal Needle client: calls Needle MCP tools over HTTP with the API key (same auth as the REST API)."""
import json
import time

import httpx

from ghostleads.backend.config import key

URL = "https://needle.app/mcp/v1"
_client = None


def call(tool, **args):
    """Call a Needle tool and return its parsed JSON result. Raises on tool errors."""
    global _client
    _client = _client or httpx.Client(timeout=90, headers={
        "Authorization": f"Bearer {key('NEEDLE_API_KEY')}",
        "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}
    for attempt in range(4):
        r = _client.post(URL, json=body)
        if r.status_code != 429:
            break
        time.sleep(2 + 2 * attempt)
    r.raise_for_status()
    text = r.text
    if not text.lstrip().startswith("{"):  # SSE framing
        text = [ln[5:] for ln in text.splitlines() if ln.startswith("data:")][-1]
    msg = json.loads(text)
    if "error" in msg:
        raise RuntimeError(f"{tool}: {msg['error']}")
    res = msg["result"]
    payload = res["content"][0]["text"] if res.get("content") else "{}"
    if res.get("isError"):
        raise RuntimeError(f"{tool}: {payload[:300]}")
    return json.loads(payload)


def linkedin_account():
    """Id of the first active connected LinkedIn account."""
    for a in call("needleListConnectedAccounts")["connectedAccounts"]:
        if a["channel"] == "linkedin" and a["status"] == "active":
            return a["id"]
    raise SystemExit("No active LinkedIn account connected in Needle")
