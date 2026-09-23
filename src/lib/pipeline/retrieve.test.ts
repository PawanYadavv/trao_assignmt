import assert from "node:assert/strict";
import test from "node:test";
import {
  companyNameFromUrl,
  decodeHtmlEntities,
  extractLinks,
  htmlToText,
  isPrivateAddress,
  robotsDisallowsPath,
  scoreLink,
  validateCompanyUrl,
} from "./retrieve";
import { extractJson } from "./llm";

test("private, loopback and reserved addresses are recognised", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1"]) {
    assert.ok(isPrivateAddress(address), `${address} should be treated as private`);
  }
  for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
    assert.ok(!isPrivateAddress(address), `${address} should be treated as public`);
  }
});

test("only http and https URLs are accepted", () => {
  assert.equal(validateCompanyUrl("https://example.com/careers").hostname, "example.com");
  assert.throws(() => validateCompanyUrl("file:///etc/passwd"), /http or https/);
  assert.throws(() => validateCompanyUrl("javascript:alert(1)"), /http or https/);
  assert.throws(() => validateCompanyUrl("not a url"), /valid URL/);
});

test("robots.txt rules are read from the group that applies to us", () => {
  const robots = `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n`;
  // The blanket Disallow belongs to Googlebot, not to us.
  assert.equal(robotsDisallowsPath(robots, "/careers"), false);
  assert.equal(robotsDisallowsPath(robots, "/admin/users"), true);
});

test("a wildcard blanket disallow is respected", () => {
  assert.equal(robotsDisallowsPath("User-agent: *\nDisallow: /", "/careers"), true);
});

test("an empty Disallow allows everything", () => {
  assert.equal(robotsDisallowsPath("User-agent: *\nDisallow:", "/careers"), false);
});

test("a more specific Allow overrides a broader Disallow", () => {
  const robots = "User-agent: *\nDisallow: /jobs\nAllow: /jobs/how-we-hire\n";
  assert.equal(robotsDisallowsPath(robots, "/jobs/listing"), true);
  assert.equal(robotsDisallowsPath(robots, "/jobs/how-we-hire"), false);
});

test("a named rule for our own agent is honoured", () => {
  const robots = "User-agent: prepwiseresearchbot\nDisallow: /\n\nUser-agent: *\nDisallow:\n";
  assert.equal(robotsDisallowsPath(robots, "/careers"), true);
});

test("hiring links outrank other pages", () => {
  const hiring = scoreLink("/handbook/how-we-hire", "How we hire");
  const careers = scoreLink("/careers", "Careers");
  const about = scoreLink("/about", "About us");
  const blog = scoreLink("/blog/2019/some-post", "A post");

  assert.equal(hiring.kind, "hiring");
  assert.ok(hiring.score > careers.score, "an explicit hiring-process page beats a generic careers page");
  assert.ok(careers.score > about.score);
  assert.ok(about.score > blog.score);
});

test("relative links are resolved and off-origin links dropped", () => {
  const base = new URL("http://localhost:8099/acme/");
  const html = `
    <a href="jobs/">Jobs</a>
    <a href="/acme/about">About us</a>
    <a href="https://twitter.com/acme">Twitter</a>
    <a href="/acme/style.css">styles</a>
  `;
  const links = extractLinks(html, base).map((link) => link.url);

  assert.ok(links.includes("http://localhost:8099/acme/jobs/"), "a relative link should resolve against the base");
  assert.ok(links.includes("http://localhost:8099/acme/about"));
  assert.ok(!links.some((url) => url.includes("twitter.com")), "off-origin links are dropped");
  assert.ok(!links.some((url) => url.endsWith(".css")), "assets are dropped");
});

test("script, style and markup are stripped from page text", () => {
  const html = `<html><head><title>T</title><style>.a{color:red}</style></head>
    <body><script>alert(1)</script><main><p>We build tools for teams.</p><p>Second line.</p></main></body></html>`;
  const text = htmlToText(html);

  assert.ok(text.includes("We build tools for teams."));
  assert.ok(!text.includes("alert"));
  assert.ok(!text.includes("color:red"));
  assert.ok(!text.includes("<"));
});

test("html entities are decoded safely", () => {
  assert.equal(decodeHtmlEntities("Tom &amp; Jerry&nbsp;&#39;s"), "Tom & Jerry 's");
  assert.equal(decodeHtmlEntities("&#x2014;"), "—");
  assert.equal(decodeHtmlEntities("&notareal;"), "&notareal;");
});

test("the company name is derived from the host", () => {
  assert.equal(companyNameFromUrl(new URL("https://www.gitlab.com")), "Gitlab");
  assert.equal(companyNameFromUrl(new URL("https://posthog.com/careers")), "Posthog");
  assert.equal(companyNameFromUrl(new URL("http://localhost:8099/acme/")), "Localhost");
});

test("JSON is recovered from a model response wrapped in prose or fences", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go:\n{"a":[1,2]}\nHope that helps.'), { a: [1, 2] });
  assert.deepEqual(extractJson('[{"a":"}"}]'), [{ a: "}" }]);
  assert.equal(extractJson("no json at all"), undefined);
});
