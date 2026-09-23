/**
 * Step 1 of the pipeline: turn a pasted job description into structured role
 * data. No network access beyond the optional model call.
 *
 * The deterministic parser is the floor, not the fallback of last resort: it
 * runs first so that the model has something to be checked against, and it is
 * what produces the kit when no API key is configured. When a model is
 * available its output is accepted only for requirements that are *grounded* -
 * the wording has to overlap the description. That is the guard against the
 * failure mode the brief calls out: inventing requirements a description does
 * not contain.
 */

import type { Requirement, RequirementKind, RequirementPriority } from "@/lib/kit/types";
import { askForJson } from "./llm";

const MAX_REQUIREMENTS = 14;

const HEADING_MUST =
  /^(requirements?|qualifications?|must[-\s]?haves?|required|essential|skills?(\s*(and|&)\s*experience)?|who you are|about you|what (you'?ll|we) (need|require|expect|look)|we'?re looking for|you (will )?have|your (background|experience))\b/i;
const HEADING_NICE =
  /^(nice[-\s]to[-\s]haves?|bonus(es)?|preferred|pluses|a plus|desirable|good to have|great to have|extra credit|optional|icing)\b/i;
const HEADING_RESPONSIBILITIES =
  /^(responsibilities|what you'?ll (do|be doing)|the role|role overview|day[-\s]to[-\s]day|your impact|in this role|duties|what the job involves)\b/i;
const HEADING_SKIP =
  /^(benefits?|perks?|compensation|salary|about (us|the (company|team|role))|why (join|us)|our (values|mission|culture)|equal opportunit|diversity|how to apply|to apply|application process|location|we offer)\b/i;

/** Inline labels that override the surrounding section. */
const INLINE_NICE = /^(?:(?:nice[-\s]to[-\s]haves?|bonus(?:\s*points)?|preferred|desirable|optional|a plus|plus)\s*(?:for\s+|[:\-–]\s*)|(?:bonus\s*points\s+for|nice\s+to\s+have)\s+)/i;
const INLINE_MUST = /^(required|must(\s*have)?|essential|minimum)\s*[:\-–]\s*/i;
/** Same markers, but appearing anywhere in a short clause. */
const NICE_ANYWHERE = /\b(nice to have|bonus points|would be a (nice )?(plus|bonus)|is a plus|are a plus|not required|desirable|preferred but not)\b/i;

const TECHNICAL_TOKENS =
  /\b(react|vue|angular|svelte|next\.?js|node\.?js|typescript|javascript|python|java|golang|\bgo\b|rust|ruby|rails|php|c\+\+|c#|\.net|swift|kotlin|sql|postgres(ql)?|mysql|mongo(db)?|redis|elasticsearch|kafka|rabbitmq|graphql|rest|grpc|api|docker|kubernetes|k8s|terraform|ansible|aws|gcp|azure|ci\/?cd|jenkins|github actions|git|linux|unix|bash|microservices?|serverless|lambda|html|css|tailwind|sass|webpack|vite|testing|unit test|integration test|e2e|jest|cypress|playwright|pytest|tdd|observability|monitoring|prometheus|grafana|datadog|on[-\s]?call|incident (response|management)|debugging|performance|latency|caching|queue|etl|airflow|dbt|spark|hadoop|pandas|numpy|machine learning|\bml\b|\bai\b|llm|pytorch|tensorflow|data (pipeline|modelling|modeling|warehouse)|schema|index(es|ing)?|query|algorithm|data structure)\b/i;
const ARCHITECTURE_TOKENS =
  /\b(architect(ure|ing)?|system design|distributed|scal(e|ing|ability|able)|high[-\s]availability|throughput|resilien(t|ce)|fault[-\s]toleran|load balanc|shard|partition|event[-\s]driven|design patterns?|trade[-\s]?offs?|capacity)\b/i;
const BEHAVIOURAL_TOKENS =
  /\b(mentor(ing|ship)?|coach(ing)?|collaborat(e|ion|ive)|communicat(e|ion|ing)|stakeholder|cross[-\s]functional|partner with|work(ing)? with (product|design|marketing|sales)|present(ing|ation)?|influence|leader(ship)?|lead(ing)? (a |the )?(team|others|engineers)|line manage|hiring|interview(ing)?|onboard(ing)?|feedback|conflict|autonom(y|ous)|ownership|proactive|self[-\s]starter|team player|written and verbal)\b/i;
const DOMAIN_TOKENS =
  /\b(fintech|healthcare|health[-\s]?tech|biotech|e[-\s]?commerce|marketplace|logistics|supply chain|insurance|banking|payments?|trading|compliance|regulatory|regulation|gdpr|hipaa|soc\s?2|pci|kyc|aml|edtech|proptech|adtech|gaming|telecom|manufacturing|retail|b2b|b2c|saas|domain (knowledge|expertise)|industry (knowledge|experience)|customer (research|insight)|product sense|user research|market)\b/i;

/** Lines that are never requirements, whatever section they appear in. */
const NOISE =
  /^(apply|send your|email us|we are an equal|equal opportunity|salary|compensation|benefits?|perks?|health insurance|401\(?k\)?|pension|holiday|vacation|visa|sponsorship available|our office|follow us|share this|posted on|job type|employment type|seniority level|department)\b/i;

/** Signals that a free-standing sentence is stating a requirement. */
const REQUIREMENT_SIGNAL =
  /\b(years?|experience|experienced|proficien(t|cy)|familiar(ity)?|knowledge|understanding|expertise|skills?|ability to|able to|comfortable|strong|solid|deep|track record|background in|degree|qualified|must|should|need(s|ed)? (to|someone|a)|looking for|we use|you (will )?use|fluent|hands[-\s]on|exposure)\b/i;

/**
 * Duty verbs. A prose sentence full of these is describing the job even when it
 * never says the word "experience", which is how most short postings are written.
 */
const ACTION_SIGNAL =
  /\b(run(ning)?|build(ing)?|design(ing)?|develop(ing)?|lead(ing)?|manage(ing)?|own(ing)?|collaborat(e|ing)|partner(ing)?|write(ing)?|writing|creat(e|ing)|ship(ping)?|maintain(ing)?|driv(e|ing)|support(ing)?|analys(e|ing)|analyz(e|ing)|implement(ing)?|deliver(ing)?|improv(e|ing)|scal(e|ing)|mentor(ing)?|test(ing)?|deploy(ing)?|operat(e|ing)|research(ing)?)\b/i;

interface Candidate {
  text: string;
  priority: RequirementPriority;
  /** True when the line came from a bullet or an explicit requirements section. */
  explicit: boolean;
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#./\s]/g, " ").replace(/\s+/g, " ").trim();
}

function stripBullet(line: string) {
  return line.replace(/^\s*(?:[-*•·–—>]+|\(?\d{1,2}[.)])\s*/, "").trim();
}

function isHeading(line: string) {
  const bare = line.replace(/[:：]\s*$/, "").trim();
  if (!bare || bare.length > 60) return false;
  return line.trimEnd().endsWith(":") || bare.split(/\s+/).length <= 6;
}

function splitSentences(paragraph: string) {
  return paragraph
    .split(/(?<=[.;!?])\s+(?=[A-Z(])/)
    .flatMap((part) => part.split(/\s*[;•]\s*/))
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * "run user research, build design systems, and collaborate with engineering"
 * is three requirements in one sentence. Split it only when each fragment
 * carries its own duty verb, so ordinary comma lists stay intact.
 */
function splitConjoinedDuties(sentence: string): string[] {
  const fragments = sentence.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+(?=\w+\s)/i).map((part) => part.trim()).filter(Boolean);
  if (fragments.length < 2) return [sentence];

  const withVerbs = fragments.filter((fragment) => ACTION_SIGNAL.test(fragment));
  if (withVerbs.length < 2) return [sentence];

  // Keep the lead-in ("We need someone to ...") attached to the first fragment.
  return fragments.filter((fragment) => fragment.length >= 10);
}

type Section = "must" | "nice" | "responsibilities" | "skip" | "unknown";

function sectionFor(heading: string): Section {
  const bare = heading.replace(/[:：]\s*$/, "").trim();
  if (HEADING_SKIP.test(bare)) return "skip";
  if (HEADING_NICE.test(bare)) return "nice";
  if (HEADING_RESPONSIBILITIES.test(bare)) return "responsibilities";
  if (HEADING_MUST.test(bare)) return "must";
  return "unknown";
}

/** Splits the description into requirement candidates and responsibility lines. */
function segment(jd: string) {
  const lines = jd.split(/\r?\n/);
  const candidates: Candidate[] = [];
  const responsibilities: string[] = [];
  let section: Section = "unknown";
  let sawExplicitSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const bulleted = /^\s*(?:[-*•·–—>]+|\(?\d{1,2}[.)])\s+/.test(rawLine);
    if (!bulleted && isHeading(line)) {
      const next = sectionFor(line);
      if (next !== "unknown") {
        section = next;
        if (next === "must" || next === "nice") sawExplicitSection = true;
        continue;
      }
    }

    const body = stripBullet(line);
    if (!body || NOISE.test(body)) continue;

    if (section === "skip") continue;
    if (section === "responsibilities") {
      if (body.length > 12) responsibilities.push(trimText(body));
      continue;
    }

    const parts = bulleted ? [body] : splitSentences(body).flatMap(splitConjoinedDuties);
    for (const part of parts) {
      const candidate = toCandidate(part, section);
      if (candidate) candidates.push(candidate);
    }
  }

  return { candidates, responsibilities, sawExplicitSection };
}

/** Drops the posting's framing so the requirement text reads as a requirement. */
const LEAD_IN =
  /^(we (are |'re )?(currently )?(looking for|seeking|need|want)( someone)?( who (can|will))?( to)?|you (will|should|must|would)( be able to| have)?|the ideal candidate (will|should|has|is)|candidates? (should|must|will)|this role (requires|involves))\s+/i;

function toCandidate(rawText: string, section: Section): Candidate | null {
  let text = rawText.trim().replace(LEAD_IN, "").trim();
  if (text.length < 8 || NOISE.test(text)) return null;

  let priority: RequirementPriority = section === "nice" ? "nice" : "must";
  let labelled = false;

  if (INLINE_NICE.test(text)) {
    text = text.replace(INLINE_NICE, "").trim();
    priority = "nice";
    labelled = true;
  } else if (INLINE_MUST.test(text)) {
    text = text.replace(INLINE_MUST, "").trim();
    priority = "must";
    labelled = true;
  } else if (NICE_ANYWHERE.test(text)) {
    priority = "nice";
    labelled = true;
  }

  // After stripping a label the remainder can legitimately be very short
  // ("Go", "C#", "AWS"), so only reject what is now empty.
  if (text.length < 2) return null;

  const explicit = section === "must" || section === "nice" || labelled;
  if (!explicit && !REQUIREMENT_SIGNAL.test(text) && !TECHNICAL_TOKENS.test(text) && !ACTION_SIGNAL.test(text)) {
    return null;
  }

  return { text: trimText(text), priority, explicit };
}

function trimText(value: string) {
  const collapsed = value.replace(/\s+/g, " ").replace(/[.;,]+$/, "").trim();
  return collapsed.length <= 180 ? collapsed : `${collapsed.slice(0, 177).trimEnd()}...`;
}

export function classifyKind(text: string): RequirementKind {
  if (TECHNICAL_TOKENS.test(text) || ARCHITECTURE_TOKENS.test(text)) return "technical";
  if (BEHAVIOURAL_TOKENS.test(text)) return "behavioural";
  if (DOMAIN_TOKENS.test(text)) return "domain";
  return "technical";
}

export function looksArchitectural(text: string) {
  return ARCHITECTURE_TOKENS.test(text);
}

function dedupe(candidates: Candidate[]) {
  const seen = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = normalise(candidate.text);
    if (!key) continue;
    const existing = seen.get(key);
    // A line labelled `must` anywhere wins over the same line seen as `nice`.
    if (!existing) seen.set(key, candidate);
    else if (existing.priority === "nice" && candidate.priority === "must") seen.set(key, candidate);
  }
  return [...seen.values()];
}

/**
 * Last resort for a description whose wording matched none of the signals.
 * Takes any sentence that is not obvious boilerplate, so a thin posting still
 * yields a thin kit rather than an empty one. The first line is skipped because
 * it is the job title.
 */
function permissiveCandidates(jd: string): Candidate[] {
  const body = jd.split(/\r?\n/).slice(1).join("\n").trim() || jd;
  return body
    .split(/\r?\n/)
    .flatMap((line) => splitSentences(stripBullet(line.trim())))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 15 && sentence.length <= 300 && !NOISE.test(sentence))
    .map((sentence) => ({
      text: trimText(sentence.replace(LEAD_IN, "").trim()),
      priority: NICE_ANYWHERE.test(sentence) ? ("nice" as RequirementPriority) : ("must" as RequirementPriority),
      explicit: false,
    }))
    .filter((candidate) => candidate.text.length >= 8);
}

/** Deterministic extraction. Always runs; used directly when no model is configured. */
export function extractRequirementsDeterministically(jd: string): Requirement[] {
  const { candidates } = segment(jd);
  const usable = candidates.length ? candidates : permissiveCandidates(jd);
  const ranked = dedupe(usable).sort((left, right) => {
    if (left.priority !== right.priority) return left.priority === "must" ? -1 : 1;
    return Number(right.explicit) - Number(left.explicit);
  });

  return ranked.slice(0, MAX_REQUIREMENTS).map((candidate, index) => ({
    id: `r${index + 1}`,
    text: candidate.text,
    kind: classifyKind(candidate.text),
    priority: candidate.priority,
    source_line: candidate.text,
  }));
}

export function extractResponsibilities(jd: string): string[] {
  const { responsibilities } = segment(jd);
  return [...new Set(responsibilities)].slice(0, 8);
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "for", "from", "have", "in", "is", "it", "of", "on",
  "or", "our", "the", "to", "with", "you", "your", "we", "us", "will", "that", "this", "their",
  "experience", "strong", "good", "work", "working", "years", "year", "using", "use",
]);

function contentWords(value: string) {
  return normalise(value).split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Anti-hallucination guard. A model-produced requirement is kept only when most
 * of its content words actually occur in the description.
 */
export function isGroundedIn(jd: string, text: string, threshold = 0.6) {
  const haystack = ` ${normalise(jd)} `;
  const words = contentWords(text);
  if (!words.length) return false;
  const present = words.filter((word) => haystack.includes(` ${word}`) || haystack.includes(word)).length;
  return present / words.length >= threshold;
}

interface ModelRequirement {
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
}

function parseModelRequirements(value: unknown): ModelRequirement[] | null {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { requirements?: unknown })?.requirements)
      ? (value as { requirements: unknown[] }).requirements
      : null;
  if (!list) return null;

  const kinds: RequirementKind[] = ["technical", "behavioural", "domain"];
  const priorities: RequirementPriority[] = ["must", "nice"];

  const parsed = list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (text.length < 4) return [];
    const kind = kinds.includes(record.kind as RequirementKind) ? (record.kind as RequirementKind) : classifyKind(text);
    const priority = priorities.includes(record.priority as RequirementPriority)
      ? (record.priority as RequirementPriority)
      : "must";
    return [{ text: trimText(text), kind, priority }];
  });

  return parsed.length ? parsed : null;
}

export interface RequirementExtraction {
  requirements: Requirement[];
  usedModel: boolean;
  droppedUngrounded: number;
}

export async function extractRequirements(jd: string): Promise<RequirementExtraction> {
  const deterministic = extractRequirementsDeterministically(jd);

  let modelRequirements: ModelRequirement[] | null = null;
  try {
    modelRequirements = await askForJson<ModelRequirement[]>({
      instruction: [
        "Extract the hiring requirements stated in the job description below.",
        "Copy the wording of the description closely; do not generalise and do not add requirements it does not state.",
        'Mark priority "must" for anything the posting requires, and "nice" only for lines it frames as a bonus, preferred, optional or nice to have.',
        'Classify kind as "technical" (tools, languages, engineering practice), "behavioural" (working with people) or "domain" (industry or product knowledge).',
        "If the description is too thin to state any requirement, return an empty array.",
      ].join("\n"),
      untrusted: [{ label: "job_description", body: jd.slice(0, 16_000) }],
      schemaHint: 'Respond with {"requirements": [{"text": string, "kind": string, "priority": string}]}.',
      parse: parseModelRequirements,
      maxTokens: 1400,
    });
  } catch {
    modelRequirements = null;
  }

  if (!modelRequirements) {
    return { requirements: deterministic, usedModel: false, droppedUngrounded: 0 };
  }

  const grounded = modelRequirements.filter((item) => isGroundedIn(jd, item.text));
  const droppedUngrounded = modelRequirements.length - grounded.length;

  if (!grounded.length) {
    return { requirements: deterministic, usedModel: false, droppedUngrounded };
  }

  const seen = new Set<string>();
  const requirements: Requirement[] = [];
  for (const item of grounded) {
    const key = normalise(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      id: `r${requirements.length + 1}`,
      text: item.text,
      kind: item.kind,
      priority: item.priority,
    });
    if (requirements.length >= MAX_REQUIREMENTS) break;
  }

  return { requirements, usedModel: true, droppedUngrounded };
}

const SENIORITY_PATTERNS: [RegExp, string][] = [
  [/\b(intern|internship)\b/i, "Intern"],
  [/\b(graduate|junior|entry[-\s]level|jr\.?)\b/i, "Junior"],
  [/\b(principal)\b/i, "Principal"],
  [/\b(staff)\b/i, "Staff"],
  [/\b(head of|director|vp of engineering)\b/i, "Leadership"],
  [/\b(lead)\b/i, "Lead"],
  [/\b(senior|sr\.?)\b/i, "Senior"],
  [/\b(mid[-\s]level|intermediate)\b/i, "Mid"],
];

export interface RoleDetails {
  title: string;
  seniority: string;
  location: string;
  responsibilities: string[];
}

/** Deterministic role metadata, used on its own when no model is configured. */
export function extractRoleDetailsDeterministically(jd: string): RoleDetails {
  const lines = jd.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // A one-line stub puts the title and the requirement in the same sentence, so
  // keep only the leading clause when the rest reads like prose.
  const first = stripBullet(lines[0] ?? "");
  const leadingClause = first.split(/(?<=[.!?])\s+/)[0]?.replace(/[.!?]+$/, "").trim() ?? "";
  const titleText = leadingClause.length >= 3 && leadingClause.length <= 90 ? leadingClause : first;
  const title = titleText.length >= 3 && titleText.length <= 90 ? trimText(titleText) : "Not specified";

  const seniorityHit = SENIORITY_PATTERNS.find(([pattern]) => pattern.test(title))
    ?? SENIORITY_PATTERNS.find(([pattern]) => pattern.test(jd.slice(0, 600)));
  const seniority = seniorityHit ? seniorityHit[1] : "Not specified";

  const locationLine = lines.find((line) => /^location\s*[:\-]/i.test(line));
  const remote = /\b(fully remote|remote[-\s]first|remote\b)/i.test(jd);
  const location = locationLine
    ? trimText(locationLine.replace(/^location\s*[:\-]\s*/i, ""))
    : remote
      ? "Remote"
      : "Not specified";

  const responsibilities = extractResponsibilities(jd);
  return { title, seniority, location, responsibilities };
}

function parseModelRole(value: unknown): Partial<RoleDetails> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? trimText(record[key] as string) : undefined);
  const responsibilities = Array.isArray(record.responsibilities)
    ? record.responsibilities.filter((item): item is string => typeof item === "string" && item.trim().length > 8).map(trimText).slice(0, 8)
    : undefined;
  const parsed = { title: text("title"), seniority: text("seniority"), location: text("location"), responsibilities };
  return parsed.title || parsed.responsibilities?.length ? parsed : null;
}

export async function extractRoleDetails(jd: string): Promise<RoleDetails> {
  const deterministic = extractRoleDetailsDeterministically(jd);

  let model: Partial<RoleDetails> | null = null;
  try {
    model = await askForJson<Partial<RoleDetails>>({
      instruction: [
        "Read the job description below and report only what it actually states.",
        'Use "Not specified" for any field the description does not state. Do not guess a location or a seniority.',
        "Responsibilities must be copied from what the posting says the person will do.",
      ].join("\n"),
      untrusted: [{ label: "job_description", body: jd.slice(0, 12_000) }],
      schemaHint:
        'Respond with {"title": string, "seniority": string, "location": string, "responsibilities": string[]}.',
      parse: parseModelRole,
      maxTokens: 700,
    });
  } catch {
    model = null;
  }

  const grounded = (value: string | undefined, fallback: string) =>
    value && value !== "Not specified" && isGroundedIn(jd, value, 0.5) ? value : fallback;

  return {
    title: grounded(model?.title, deterministic.title),
    seniority: grounded(model?.seniority, deterministic.seniority),
    location: grounded(model?.location, deterministic.location),
    responsibilities: (model?.responsibilities ?? []).filter((item) => isGroundedIn(jd, item, 0.5)).length
      ? model!.responsibilities!.filter((item) => isGroundedIn(jd, item, 0.5))
      : deterministic.responsibilities,
  };
}
