/**
 * Step 3 of the pipeline: turn retrieved pages into a company brief.
 *
 * The honesty rule from the brief lives here: a company we could find nothing
 * about produces a brief that says so, rather than a fabricated one. When there
 * is no usable page text we never call the model at all.
 */

import type { Kit } from "@/lib/kit/types";
import type { ResearchResult } from "./retrieve";
import { askForJson } from "./llm";

export const NO_COMPANY_INFO =
  "We could not retrieve enough from this company's website to describe it honestly. Treat the role breakdown below as the reliable part of this kit, and read the company's own site before the interview.";

export const NO_HIRING_INFO =
  "No published hiring or interview process was found for this company, so the questions below are driven by the job description rather than a known interview format.";

interface BriefFields {
  summary: string;
  what_they_do: string;
  how_they_hire: string;
}

function parseBrief(value: unknown): BriefFields | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? record[key].trim() : "");
  const summary = text("summary");
  const whatTheyDo = text("what_they_do");
  if (summary.length < 20 && whatTheyDo.length < 20) return null;
  return {
    summary: summary.slice(0, 700),
    what_they_do: whatTheyDo.slice(0, 900),
    how_they_hire: text("how_they_hire").slice(0, 900),
  };
}

function firstUsefulText(research: ResearchResult, limit: number) {
  return research.pages
    .filter((page) => page.text.length > 120)
    .map((page) => `${page.title}\n${page.text}`)
    .join("\n\n")
    .slice(0, limit);
}

export async function buildCompanyBrief(
  companyName: string,
  research: ResearchResult,
): Promise<{ brief: Kit["company_brief"]; usedModel: boolean }> {
  const sources = research.pages.map((page) => page.url);
  const corpus = firstUsefulText(research, 9000);
  const hiringText = research.hiringPages.map((page) => page.text).join("\n\n").slice(0, 6000);
  const discussionText = research.discussionPages.map((page) => `${page.title}. ${page.text}`).join("\n\n").slice(0, 3000);

  // Nothing worth summarising: say so rather than asking a model to imagine it.
  if (corpus.length < 200) {
    return {
      brief: {
        summary: NO_COMPANY_INFO,
        what_they_do: NO_COMPANY_INFO,
        how_they_hire: NO_HIRING_INFO,
        sources,
        state: "generated",
      },
      usedModel: false,
    };
  }

  try {
    const fields = await askForJson<BriefFields>({
      instruction: [
        `Summarise the company "${companyName}" using only the retrieved pages below.`,
        "summary: two or three sentences a candidate could use in an interview.",
        "what_they_do: their product and who it is for, in plain language.",
        'how_they_hire: only what the pages actually state about their interview or hiring process. If the pages say nothing about hiring, return an empty string.',
        "If the pages are mostly navigation or boilerplate, say that the site gave little away rather than inventing detail.",
      ].join("\n"),
      untrusted: [
        { label: "company_pages", body: corpus },
        ...(hiringText ? [{ label: "hiring_pages", body: hiringText }] : []),
        ...(discussionText ? [{ label: "public_discussion", body: discussionText }] : []),
      ],
      schemaHint: 'Respond with {"summary": string, "what_they_do": string, "how_they_hire": string}.',
      parse: parseBrief,
      maxTokens: 900,
    });

    if (fields) {
      return {
        brief: {
          summary: fields.summary || NO_COMPANY_INFO,
          what_they_do: fields.what_they_do || NO_COMPANY_INFO,
          how_they_hire: fields.how_they_hire || NO_HIRING_INFO,
          sources,
          state: "generated",
        },
        usedModel: true,
      };
    }
  } catch {
    // fall through to the extractive brief
  }

  return { brief: extractiveBrief(companyName, research, sources), usedModel: false };
}

/**
 * Model-free brief. Quotes the site rather than paraphrasing it, which keeps it
 * honest: every sentence here came from a page we actually fetched.
 */
export function extractiveBrief(
  companyName: string,
  research: ResearchResult,
  sources: string[],
): Kit["company_brief"] {
  const home = research.pages.find((page) => page.kind === "home" && page.text.length > 80) ?? research.pages[0];
  const homeText = home?.text ?? "";
  const whatTheyDo = homeText.length > 80 ? `${firstSentences(homeText, 3)}` : NO_COMPANY_INFO;

  const hiring = research.hiringPages.find((page) => page.text.length > 120);
  const howTheyHire = hiring
    ? `From ${hiring.url}: ${firstSentences(hiring.text, 4)}`
    : NO_HIRING_INFO;

  const pageCount = research.pages.length;
  const summary =
    homeText.length > 80
      ? `${companyName} was researched from ${pageCount} public page${pageCount === 1 ? "" : "s"}. ${firstSentences(homeText, 2)}`
      : NO_COMPANY_INFO;

  return {
    summary: summary.slice(0, 700),
    what_they_do: whatTheyDo.slice(0, 900),
    how_they_hire: howTheyHire.slice(0, 900),
    sources,
    state: "generated",
  };
}

function firstSentences(text: string, count: number) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().length > 25);
  return sentences.slice(0, count).join(" ").trim();
}
