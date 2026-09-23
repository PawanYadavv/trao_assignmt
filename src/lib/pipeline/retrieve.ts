

export interface RetrievedPage {
  url: string;
  title: string;
  text: string;
}

async function publicInterviewDiscussion(company: string): Promise<RetrievedPage[]> {
  try {
    const response = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(company + " interview")}&tags=story&hitsPerPage=3`, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return [];
    const payload = await response.json() as { hits?: { title?: string; url?: string; story_text?: string }[] };
    return (payload.hits ?? []).filter((hit) => hit.url || hit.story_text).map((hit) => ({ url: hit.url ?? `https://news.ycombinator.com/`, title: hit.title ?? "Public discussion", text: decodeHtmlEntities(hit.story_text ?? hit.title ?? "") }));
  } catch {
    return [];
  }
}

function isPrivateHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function validateCompanyUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Company URL must use http or https.');
  if (process.env.NODE_ENV === 'production' && isPrivateHost(url.hostname)) throw new Error('Private company hosts are not allowed in production.');
  return url;
}

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'PrepwiseResearch/1.0' }, signal: AbortSignal.timeout(8000) });
      if (response.ok) return response;
      if (response.status < 500) throw new Error(`Source returned ${response.status}.`);
      lastError = new Error(`Source returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error('Source could not be retrieved.');
}

async function robotsAllow(root: URL) {
  try {
    const response = await fetchWithRetry(new URL("/robots.txt", root).toString(), 1);
    const rules = (await response.text()).split(/\r?\n/).map((line) => line.trim());
    const blocked = rules.some((line) => /^disallow:\s*\/$/i.test(line));
    return !blocked;
  } catch {
    return true;
  }
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name.toLowerCase()] ?? match);
}

function cleanText(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|form|aside|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000);
}

function metaDescription(html: string) {
  return html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
}

function researchText(html: string) {
  const description = metaDescription(html);
  const main = html.match(/<(main|article)[^>]*>[\s\S]*?<\/\1>/i)?.[0] ?? html;
  const text = cleanText(main);
  const looksLikeNavigation = /gmail|images|sign in|advanced search|advertising|terms|privacy/i.test(text) && text.length < 1200;
  if (description) return decodeHtmlEntities(description).slice(0, 800);
  if (looksLikeNavigation) return "";
  return text;
}

function linksFromHtml(html: string, base: URL) {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)].flatMap((match) => {
    try {
      const url = new URL(match[1], base);
      const blockedPath = /\/_next\/|\/favicon|\.(css|js|map|ico|png|jpg|jpeg|svg|woff2?)$/i.test(url.pathname);
      return url.origin === base.origin && !blockedPath ? [url.toString()] : [];
    } catch { return []; }
  });
}

export async function researchCompany(companyUrl: string): Promise<{ pages: RetrievedPage[]; warnings: string[] }> {
  const root = validateCompanyUrl(companyUrl);
  const warnings: string[] = [];
  const pages: RetrievedPage[] = [];
  if (!(await robotsAllow(root))) {
    return { pages, warnings: ["Research skipped because robots.txt disallows crawling this site."] };
  }
  const response = await fetchWithRetry(root.toString());
  const html = await response.text();
  pages.push({ url: root.toString(), title: html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() ?? root.hostname, text: researchText(html) });
  const candidates = [...new Set(linksFromHtml(html, root))].sort((left, right) => Number(/career|job|hire|work/i.test(right)) - Number(/career|job|hire|work/i.test(left))).slice(0, 3);
  for (const candidate of candidates) {
    try {
      const pageResponse = await fetchWithRetry(candidate, 2);
      const pageHtml = await pageResponse.text();
      pages.push({ url: candidate, title: pageHtml.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() ?? candidate, text: researchText(pageHtml) });
    } catch { warnings.push(`Skipped unreachable source: ${candidate}`); }
  }
  const discussion = await publicInterviewDiscussion(root.hostname.replace(/^www\./, '').split('.')[0]);
  pages.push(...discussion);
  if (pages.length === 1) warnings.push('No additional company or hiring pages were discoverable.');
  return { pages, warnings };
}

