import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRobots, robotsAllows } from "../../server/robots.js";

const allows = (robots: string, path: string) => robotsAllows(parseRobots(robots), path);

test("no rules, empty Disallow and comments allow everything", () => {
  assert.equal(allows("", "/anything"), true);
  assert.equal(allows("User-agent: *\nDisallow:\n", "/anything"), true);
  assert.equal(allows("# just a comment\nSitemap: https://x.test/sitemap.xml", "/a"), true);
});

test("Disallow blocks by path prefix", () => {
  const robots = "User-agent: *\nDisallow: /admin\nDisallow: /tmp/ # trailing comment\n";
  assert.equal(allows(robots, "/admin"), false);
  assert.equal(allows(robots, "/admin/users"), false);
  assert.equal(allows(robots, "/tmp/x"), false);
  assert.equal(allows(robots, "/tmp"), true);
  assert.equal(allows(robots, "/about"), true);
  assert.equal(allows("User-agent: *\nDisallow: /", "/"), false);
});

test("the longest matching rule wins, and Allow wins a tie", () => {
  const robots = "User-agent: *\nDisallow: /shop\nAllow: /shop/public\nDisallow: /shop/public/secret";
  assert.equal(allows(robots, "/shop/cart"), false);
  assert.equal(allows(robots, "/shop/public/list"), true);
  assert.equal(allows(robots, "/shop/public/secret/1"), false);
  assert.equal(allows("User-agent: *\nDisallow: /a\nAllow: /a", "/a"), true);
});

test("wildcards and end anchors", () => {
  const robots = "User-agent: *\nDisallow: /*?page=\nDisallow: /*.pdf$\nAllow: /search$";
  assert.equal(allows(robots, "/jobs?page=2"), false);
  assert.equal(allows(robots, "/jobs"), true);
  assert.equal(allows(robots, "/files/report.pdf"), false);
  assert.equal(allows(robots, "/files/report.pdf.html"), true);
  assert.equal(allows(robots, "/a.b(c)+d"), true); // regex characters in paths are literal
});

test("a group naming GhostLeadsBot replaces the * group", () => {
  const robots = [
    "User-agent: *", "Disallow: /",
    "", "User-agent: Googlebot", "Disallow: /nogoogle",
    "", "User-agent: GhostLeadsBot", "Disallow: /team",
  ].join("\n");
  assert.equal(allows(robots, "/contact"), true);
  assert.equal(allows(robots, "/team"), false);
  assert.equal(allows(robots, "/nogoogle"), true);
});

test("consecutive User-agent lines share one group; other bots' groups are ignored", () => {
  const robots = "User-agent: Bingbot\nUser-agent: *\nDisallow: /both\n\nUser-agent: AhrefsBot\nDisallow: /\n";
  assert.equal(allows(robots, "/both"), false);
  assert.equal(allows(robots, "/fine"), true);
});

test("field names are case-insensitive and CRLF files parse", () => {
  assert.equal(allows("USER-AGENT: *\r\nDISALLOW: /x\r\n", "/x/y"), false);
});
