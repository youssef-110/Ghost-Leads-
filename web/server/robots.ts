// robots.txt parsing and matching (RFC 9309): most specific user-agent group, longest matching rule wins.

export type RobotsRule = { allow: boolean; pattern: RegExp; length: number };

/** Rules that apply to `agent` (product token, lowercase): its own groups if any name it, otherwise the `*` groups. */
export function parseRobots(text: string, agent = "ghostleadsbot"): RobotsRule[] {
  const own: RobotsRule[] = [];
  const any: RobotsRule[] = [];
  let targets: RobotsRule[][] = [];
  let inAgents = false; // consecutive User-agent lines share one group
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!inAgents) targets = [];
      inAgents = true;
      const ua = value.toLowerCase();
      if (ua === "*") targets.push(any);
      else if (ua && agent.startsWith(ua)) targets.push(own);
    } else if (field === "allow" || field === "disallow") {
      inAgents = false;
      if (!value) continue; // "Disallow:" with no path allows everything
      const anchored = value.endsWith("$");
      const body = (anchored ? value.slice(0, -1) : value)
        .split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      const rule = { allow: field === "allow", pattern: new RegExp("^" + body + (anchored ? "$" : "")), length: value.length };
      for (const t of targets) t.push(rule);
    } else {
      inAgents = false;
    }
  }
  return own.length ? own : any;
}

export function robotsAllows(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!r.pattern.test(pathAndQuery)) continue;
    if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
