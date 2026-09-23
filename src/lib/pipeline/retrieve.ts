/**
 * Step 2 of the pipeline: retrieval.
 *
 * Everything here treats the open web as hostile input. URLs are validated and
 * resolved before they are fetched, responses are capped by content type and
 * size, robots.txt is parsed per user-agent group, and a source that cannot be
 * retrieved is recorded as a warning rather than failing the run.
 *
 * The hiring page is *found*, not guessed: links are scored on path and anchor
 * text, the best candidates are fetched, and a careers page is expanded one
 * level deeper because "how we hire" usually hangs off it.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const USER_AGENT = "PrepwiseResearchBot/1.0 (+interview-prep-kit; respects robots.txt)";
const PAGE_BYTE_LIMIT = 1_500_000;
const PAGE_TEXT_LIMIT = 12_000;
const FETCH_TIMEOUT_MS = 8_000;
const POLITE_DELAY_MS = 300;
const MAX_COMPANY_PAGES = 6;

export type PageKind = "home" | "hiring" | "about" | "discussion" | "other";

export interface RetrievedPage {
  url: string;
  title: string;
  text: string;
  kind: PageKind;
  /** The page's own meta description, which beats scraped nav text in a brief. */
  description?: string;
}

export interface ResearchResult {
  pages: RetrievedPage[];
  hiringPages: RetrievedPage[];
  discussionPages: RetrievedPage[];
  warnings: string[];
  /** False when the company site itself could not be reached at all. */
  reachable: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- URL safety --------------------------------------------------------------

function allowPrivateTargets() {
  const flag = process.env.ALLOW_PRIVATE_CRAWL_TARGETS?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  // The batch harness may serve company sites from localhost, so private
  // targets are allowed outside production unless explicitly switched off.
  return process.env.NODE_ENV !== "production";
}

/** Blocks loopback, link-local, private and reserved ranges (SSRF guard). */
export function isPrivateAddress(address: string) {
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    if (value === "::1" || value === "::") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique local
    if (value.startsWith("fe80")) return true; // link local
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    return false;
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export class RetrievalError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "RetrievalError";
  }
}

export function validateCompanyUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RetrievalError("That does not look like a valid URL.", "INVALID_URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new RetrievalError("The company URL must use http or https.", "INVALID_URL");
  }
  if (!url.hostname) {
    throw new RetrievalError("The company URL is missing a hostname.", "INVALID_URL");
  }
  return url;
}

/** Resolves the host and rejects addresses we must not fetch. */
async function assertFetchable(url: URL) {
  if (allowPrivateTargets()) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  const addresses = literal
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);

  if (!addresses.length) {
    throw new RetrievalError(`Could not resolve ${url.hostname}.`, "COMPANY_UNREACHABLE");
  }
  if (addresses.some(isPrivateAddress)) {
    throw new RetrievalError("Refusing to fetch a private or loopback address.", "BLOCKED_ADDRESS");
  }
}

// --- Fetching ----------------------------------------------------------------

const TEXTUAL = /^(text\/html|text\/plain|application\/xhtml\+xml)/i;

async function readCapped(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PAGE_BYTE_LIMIT) {
    throw new RetrievalError("Response was larger than the page limit.", "PAGE_TOO_LARGE");
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PAGE_BYTE_LIMIT) {
      await reader.cancel();
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function fetchTextual(url: string, attempts: number): Promise<{ body: string; url: string }> {
  let lastError: Error = new RetrievalError("Source could not be retrieved.", "COMPANY_UNREACHABLE");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = new RetrievalError(`Source returned ${response.status}.`, "COMPANY_UNREACHABLE");
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 400 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        throw new RetrievalError(`Source returned ${response.status}.`, "COMPANY_UNREACHABLE");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !TEXTUAL.test(contentType)) {
        throw new RetrievalError(`Skipped unsupported content type ${contentType.split(";")[0]}.`, "UNSUPPORTED_CONTENT");
      }

      return { body: await readCapped(response), url: response.url || url };
    } catch (error) {
      // A 4xx or a wrong content type will not change on a retry.
      if (error instanceof RetrievalError && error.code === "UNSUPPORTED_CONTENT") throw error;
      lastError = error instanceof Error ? error : new Error("Source could not be retrieved.");
      if (attempt < attempts - 1) await sleep(400 * 2 ** attempt);
    }
  }

  throw lastError;
}

// --- robots.txt --------------------------------------------------------------

/** Parses robots.txt into the rules that apply to our user agent. */
export function robotsDisallowsPath(robotsTxt: string, path: string, userAgent = "prepwiseresearchbot") {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (!current) continue;
    lastWasAgent = false;
    if (field === "disallow") current.disallow.push(value);
    else if (field === "allow") current.allow.push(value);
  }

  const specific = groups.find((group) => group.agents.some((agent) => agent !== "*" && userAgent.includes(agent)));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  const group = specific ?? wildcard;
  if (!group) return false;

  const matches = (rule: string) => rule !== "" && path.startsWith(rule.replace(/\*$/, ""));
  const longest = (rules: string[]) => rules.filter(matches).reduce((best, rule) => Math.max(best, rule.length), 0);

  // An empty Disallow means "allow everything" for this group.
  const disallowDepth = longest(group.disallow);
  const allowDepth = longest(group.allow);
  return disallowDepth > 0 && disallowDepth > allowDepth;
}

async function loadRobots(root: URL) {
  try {
    const { body } = await fetchTextual(new URL("/robots.txt", root).toString(), 1);
    return body.slice(0, 100_000);
  } catch {
    // No robots.txt, or it could not be read: crawling is permitted by default.
    return "";
  }
}

// --- HTML cleaning -----------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", mdash: "—", ndash: "–", rsquo: "'", lsquo: "'",
};

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&([a-z#0-9]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

export function htmlToText(html: string) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|form|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(stripped)
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim()
    .slice(0, PAGE_TEXT_LIMIT);
}

/** <meta name="description"> or the OpenGraph equivalent. */
export function metaDescription(html: string) {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const value = match?.[1]?.trim();
  return value ? decodeHtmlEntities(value).replace(/\s+/g, " ").slice(0, 600) : "";
}

function pageTitle(html: string, fallback: string) {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return raw ? decodeHtmlEntities(raw).replace(/\s+/g, " ").trim().slice(0, 160) || fallback : fallback;
}

/** A page that is mostly chrome carries no signal, so it is dropped. */
function isLowSignal(text: string) {
  if (text.length < 200) return true;
  const words = text.split(/\s+/).length;
  return words < 40;
}

// --- Link discovery ----------------------------------------------------------

const HIRING_PATTERNS: [RegExp, number][] = [
  [/how[-\s]?we[-\s]?hire|hiring[-\s]?process|interview[-\s]?process|interviewing/i, 30],
  [/careers?|jobs?|vacanc|openings?|opportunities/i, 18],
  [/join[-\s]?us|work[-\s]?(with|for|at)[-\s]?us|working[-\s]?here|life[-\s]?at/i, 15],
  [/handbook|culture|values|team|people|employ/i, 8],
  [/recruit|talent|apply|hiring/i, 12],
  [/engineering[-\s]?blog|blog\/engineering/i, 5],
];

const ABOUT_PATTERNS: [RegExp, number][] = [
  [/\/about|about[-\s]?us|our[-\s]?story|who[-\s]?we[-\s]?are|mission/i, 14],
  [/\/(product|platform|solutions|what[-\s]?we[-\s]?do)/i, 9],
];

const LINK_NOISE =
  /\/(login|signin|sign-in|signup|register|cart|checkout|privacy|terms|legal|cookie|status|pricing|docs?|support|help|contact|press|investors?|security|sitemap)(\/|$)|\.(pdf|zip|png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|rss|woff2?|ttf|mp4|mp3)$|^\/_next\/|^\/cdn-cgi\//i;

interface ScoredLink {
  url: string;
  score: number;
  kind: PageKind;
}

export function scoreLink(pathAndQuery: string, anchorText: string): { score: number; kind: PageKind } {
  const haystack = `${pathAndQuery} ${anchorText}`;
  let score = 0;
  let kind: PageKind = "other";

  for (const [pattern, weight] of HIRING_PATTERNS) {
    if (pattern.test(haystack)) {
      score += weight;
      kind = "hiring";
    }
  }
  for (const [pattern, weight] of ABOUT_PATTERNS) {
    if (pattern.test(haystack)) {
      score += weight;
      if (kind !== "hiring") kind = "about";
    }
  }

  // Prefer shallow pages when scores tie; deep links are usually individual posts.
  const depth = pathAndQuery.split("/").filter(Boolean).length;
  score -= Math.max(0, depth - 2) * 2;
  return { score, kind };
}

/** Extracts same-origin links with their anchor text, resolving relative hrefs. */
export function extractLinks(html: string, base: URL): ScoredLink[] {
  const found = new Map<string, ScoredLink>();
  const anchors = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi);

  for (const match of anchors) {
    let url: URL;
    try {
      url = new URL(match[1], base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    if (!["http:", "https:"].includes(url.protocol)) continue;

    url.hash = "";
    const pathAndQuery = `${url.pathname}${url.search}`;
    if (LINK_NOISE.test(pathAndQuery)) continue;
    if (url.toString() === base.toString()) continue;

    const anchorText = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120);
    const { score, kind } = scoreLink(pathAndQuery, anchorText);
    if (score <= 0) continue;

    const key = url.toString();
    const existing = found.get(key);
    if (!existing || existing.score < score) found.set(key, { url: key, score, kind });
  }

  return [...found.values()].sort((left, right) => right.score - left.score);
}

// --- Public discussion -------------------------------------------------------

/**
 * Public discussion of how a company interviews. Hacker News' Algolia API is
 * used because it is free, keyless and explicitly public; results are filtered
 * to items that actually mention the company.
 */
async function searchPublicDiscussion(companyName: string): Promise<{ pages: RetrievedPage[]; warnings: string[] }> {
  const queries = [`${companyName} interview`, `${companyName} hiring process`];
  const pages = new Map<string, RetrievedPage>();
  const warnings: string[] = [];
  const needle = companyName.toLowerCase();

  for (const query of queries) {
    try {
      const response = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=5`,
        { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(6000) },
      );
      if (!response.ok) {
        warnings.push(`Public discussion search returned ${response.status}.`);
        continue;
      }

      const payload = (await response.json()) as {
        hits?: { objectID?: string; title?: string; story_title?: string; url?: string; story_text?: string; comment_text?: string }[];
      };

      for (const hit of payload.hits ?? []) {
        const title = (hit.title ?? hit.story_title ?? "Public discussion").slice(0, 160);
        const body = decodeHtmlEntities((hit.story_text ?? hit.comment_text ?? "").replace(/<[^>]+>/g, " "))
          .replace(/\s+/g, " ")
          .trim();
        const haystack = `${title} ${body}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
        if (!body && !hit.url) continue;

        const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`;
        if (pages.has(url)) continue;
        pages.set(url, { url, title, text: body.slice(0, 2000) || title, kind: "discussion" });
      }
      await sleep(POLITE_DELAY_MS);
    } catch {
      warnings.push("Public discussion search was unavailable.");
    }
  }

  return { pages: [...pages.values()].slice(0, 4), warnings };
}

// --- Orchestration -----------------------------------------------------------

/** Generic subdomains that name a section of a site, not the company. */
const GENERIC_SUBDOMAINS = new Set([
  "www", "about", "jobs", "careers", "blog", "docs", "app", "web", "home", "info", "handbook", "life", "join", "work",
]);
const PUBLIC_SUFFIXES = new Set([
  "com", "co", "uk", "io", "dev", "ai", "org", "net", "app", "us", "de", "fr", "in", "eu", "tech", "xyz", "so", "sh",
]);

export function companyNameFromUrl(url: URL) {
  const labels = url.hostname.split(".").filter(Boolean);
  const meaningful = labels.filter((label) => !GENERIC_SUBDOMAINS.has(label) && !PUBLIC_SUFFIXES.has(label));
  const label = meaningful[meaningful.length - 1] ?? labels[0] ?? url.hostname;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export async function researchCompany(companyUrl: string): Promise<ResearchResult> {
  const root = validateCompanyUrl(companyUrl);
  const warnings: string[] = [];
  const pages: RetrievedPage[] = [];

  await assertFetchable(root);

  const robots = await loadRobots(root);
  const allowed = (url: URL) => !robotsDisallowsPath(robots, `${url.pathname}${url.search}`);

  if (!allowed(root)) {
    warnings.push("The company site's robots.txt disallows crawling its homepage, so no company pages were read.");
    const discussion = await searchPublicDiscussion(companyNameFromUrl(root));
    warnings.push(...discussion.warnings);
    return {
      pages: discussion.pages,
      hiringPages: [],
      discussionPages: discussion.pages,
      warnings,
      reachable: true,
    };
  }

  // 1. Homepage.
  let homeHtml: string;
  try {
    const home = await fetchTextual(root.toString(), 3);
    homeHtml = home.body;
    const text = htmlToText(homeHtml);
    pages.push({
      url: home.url,
      title: pageTitle(homeHtml, root.hostname),
      text,
      kind: "home",
      description: metaDescription(homeHtml),
    });
    if (isLowSignal(text)) {
      warnings.push("The company homepage returned very little readable text.");
    }
  } catch (error) {
    warnings.push(
      `The company website could not be read (${error instanceof Error ? error.message : "unknown error"}). The kit was built from the job description alone.`,
    );
    const discussion = await searchPublicDiscussion(companyNameFromUrl(root));
    warnings.push(...discussion.warnings);
    if (!discussion.pages.length) warnings.push("No public discussion of this company's interview process was found.");
    return {
      pages: discussion.pages,
      hiringPages: [],
      discussionPages: discussion.pages,
      warnings,
      reachable: false,
    };
  }

  // 2. Rank the homepage's links and fetch the best candidates.
  const queue = extractLinks(homeHtml, root).filter((link) => allowed(new URL(link.url)));
  const visited = new Set<string>([root.toString()]);
  let expandedCareers = false;

  while (queue.length && pages.length < MAX_COMPANY_PAGES) {
    const candidate = queue.shift()!;
    if (visited.has(candidate.url)) continue;
    visited.add(candidate.url);

    await sleep(POLITE_DELAY_MS);
    try {
      const fetched = await fetchTextual(candidate.url, 2);
      const text = htmlToText(fetched.body);
      if (isLowSignal(text)) {
        warnings.push(`Skipped ${candidate.url}: too little readable text.`);
        continue;
      }
      pages.push({
        url: fetched.url,
        title: pageTitle(fetched.body, candidate.url),
        text,
        kind: candidate.kind,
        description: metaDescription(fetched.body),
      });

      // 3. A careers page usually links to the real "how we hire" page, so
      //    expand it one level rather than guessing the path.
      if (candidate.kind === "hiring" && !expandedCareers) {
        expandedCareers = true;
        const nested = extractLinks(fetched.body, new URL(fetched.url))
          .filter((link) => link.kind === "hiring" && !visited.has(link.url) && allowed(new URL(link.url)))
          .slice(0, 3);
        queue.unshift(...nested);
      }
    } catch (error) {
      warnings.push(`Skipped unreachable source ${candidate.url}: ${error instanceof Error ? error.message : "fetch failed"}.`);
    }
  }

  const hiringPages = pages.filter((page) => page.kind === "hiring");
  if (!hiringPages.length) {
    warnings.push("No hiring or interview-process page was discoverable on this company's site.");
  }

  // 4. Public discussion of how they interview.
  const discussion = await searchPublicDiscussion(companyNameFromUrl(root));
  warnings.push(...discussion.warnings);
  if (!discussion.pages.length) {
    warnings.push("No public discussion of this company's interview process was found.");
  }
  pages.push(...discussion.pages);

  return { pages, hiringPages, discussionPages: discussion.pages, warnings, reachable: true };
}
