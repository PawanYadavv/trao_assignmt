/**
 * Pipeline orchestrator.
 *
 * The kit is built by a sequence of steps that respond to what was actually
 * found, not by one prompt that returns everything:
 *
 *   1. retrieve   crawl the company site, find a hiring page, search public discussion
 *   2. extract    pull requirements and role details out of the pasted description
 *   3. brief      summarise the company from the pages we actually fetched
 *   4. questions  one call per category, shaped by the hiring process if we found one
 *   5. coverage   deterministic gap check, then corrective passes until it closes
 *   6. flashcards recall cards per requirement
 *   7. schedule   arithmetic allocation across exactly the days requested
 *   8. validate   structural check before the kit is allowed out
 *
 * Steps 5 and 7 never touch the model: they are the two decisions the brief
 * says belong to the code.
 */

import { buildCoverageReport } from "@/lib/kit/coverage";
import { buildSchedule, clampDays } from "@/lib/kit/schedule";
import { assertValidKit } from "@/lib/kit/validate";
import type { Kit, Question, QuestionCategory, Requirement } from "@/lib/kit/types";
import { buildCompanyBrief } from "./brief";
import { extractRequirements, extractRoleDetails } from "./extract";
import { generateFlashcards } from "./flashcards";
import { isLlmConfigured, readLlmConfig } from "./llm";
import {
  categoriesFor,
  generateQuestionsForCategory,
  groupByCategory,
  templateQuestionsFor,
  type GenerationContext,
  type QuestionDraft,
} from "./questions";
import { companyNameFromUrl, researchCompany, validateCompanyUrl, type ResearchResult } from "./retrieve";

/**
 * How many coverage passes we are willing to run.
 *
 * Pass 1 is the first draft. Passes 2 and 3 are corrective: they only ask for
 * the requirements that came back uncovered, which is a much smaller prompt.
 * Three is where the returns stop - in practice a targeted pass closes the gap
 * on the first attempt, and a model that has failed twice on the same
 * requirement is not going to succeed on the fourth. Anything still uncovered
 * after that is closed deterministically, because shipping a kit with an
 * uncovered must-have is the one outcome that is not acceptable.
 */
export const MAX_COVERAGE_PASSES = 3;

export interface PipelineInput {
  jd: string;
  company_url: string;
  days: number;
}

export type PipelineStage =
  | "researching"
  | "extracting"
  | "briefing"
  | "questioning"
  | "covering"
  | "flashcards"
  | "scheduling"
  | "validating"
  | "done";

export interface ProgressEvent {
  stage: PipelineStage;
  message: string;
  /** 0-100, for a progress bar. */
  percent: number;
}

export type ProgressReporter = (event: ProgressEvent) => void;

const STAGE_PERCENT: Record<PipelineStage, number> = {
  researching: 15,
  extracting: 30,
  briefing: 45,
  questioning: 65,
  covering: 78,
  flashcards: 86,
  scheduling: 92,
  validating: 97,
  done: 100,
};

function report(onProgress: ProgressReporter | undefined, stage: PipelineStage, message: string) {
  onProgress?.({ stage, message, percent: STAGE_PERCENT[stage] });
}

/** Empty research, used when the company site could not be reached at all. */
function emptyResearch(warnings: string[]): ResearchResult {
  return { pages: [], hiringPages: [], discussionPages: [], warnings, reachable: false };
}

function questionFromDraft(draft: QuestionDraft, id: string, pass: number): Question {
  return { ...draft, id, added_in_pass: pass > 1 ? pass : undefined };
}

/**
 * Runs retrieval and generation. This is the single entry point used by both
 * the HTTP API and the batch command.
 */
export async function runPipeline(input: PipelineInput, onProgress?: ProgressReporter): Promise<Kit> {
  // Reject a malformed URL before any work is done.
  validateCompanyUrl(input.company_url);

  report(onProgress, "researching", "Crawling the company site and looking for how they hire");
  let research: ResearchResult;
  try {
    research = await researchCompany(input.company_url);
  } catch (error) {
    // Retrieval failing is not fatal: the description alone still makes a kit.
    research = emptyResearch([
      `Company research failed: ${error instanceof Error ? error.message : "unknown error"}. The kit was built from the job description alone.`,
    ]);
  }

  return generateKit(input, research, onProgress);
}

export async function generateKit(
  input: PipelineInput,
  research: ResearchResult,
  onProgress?: ProgressReporter,
): Promise<Kit> {
  const url = validateCompanyUrl(input.company_url);
  const companyName = companyNameFromUrl(url);
  const warnings = [...research.warnings];
  const days = clampDays(input.days);

  // --- 2. Extract -----------------------------------------------------------
  report(onProgress, "extracting", "Reading the job description for requirements");
  const [{ requirements, usedModel: requirementsFromModel, droppedUngrounded }, roleDetails] = await Promise.all([
    extractRequirements(input.jd),
    extractRoleDetails(input.jd),
  ]);

  if (!requirements.length) {
    warnings.push(
      "This job description was too thin to extract any requirement from. The kit below is correspondingly thin - it is not padded with requirements the posting does not state.",
    );
  } else if (requirements.length <= 2 && input.jd.trim().length < 300) {
    warnings.push(
      `Only ${requirements.length} requirement${requirements.length === 1 ? "" : "s"} could be read from this description, so the kit is deliberately small rather than invented.`,
    );
  }
  if (droppedUngrounded > 0) {
    warnings.push(
      `${droppedUngrounded} suggested requirement${droppedUngrounded === 1 ? "" : "s"} did not appear in the description and ${droppedUngrounded === 1 ? "was" : "were"} discarded.`,
    );
  }

  // --- 3. Company brief -----------------------------------------------------
  report(onProgress, "briefing", "Summarising what the company does");
  const { brief } = await buildCompanyBrief(companyName, research);

  const hiringProcess = research.hiringPages.map((page) => page.text).join("\n\n").slice(0, 6000) || null;
  const context: GenerationContext = {
    company: companyName,
    roleTitle: roleDetails.title,
    seniority: roleDetails.seniority,
    hiringProcess,
    companySummary: research.pages.find((page) => page.kind === "home")?.text.slice(0, 2000) ?? null,
  };

  // --- 4. Questions, one call per category ---------------------------------
  report(onProgress, "questioning", "Writing questions for each requirement category");
  const questions: Question[] = [];
  let nextQuestionNumber = 1;
  const addDrafts = (drafts: QuestionDraft[], pass: number) => {
    for (const draft of drafts) {
      questions.push(questionFromDraft(draft, `q${nextQuestionNumber}`, pass));
      nextQuestionNumber += 1;
    }
  };

  const groups = groupByCategory(requirements);
  const categoryResults = await Promise.all(
    [...groups.entries()].map(async ([category, categoryRequirements]) => ({
      category,
      result: await generateQuestionsForCategory(categoryRequirements, category, context),
    })),
  );
  for (const { result } of categoryResults) {
    addDrafts(result.drafts, 1);
  }

  // Always give the candidate something to say about the company itself.
  if (requirements.length && !questions.some((question) => question.category === "company-fit")) {
    const anchor = requirements[0];
    const { drafts } = await generateQuestionsForCategory([anchor], "company-fit", context);
    addDrafts(drafts.slice(0, 2), 1);
  }

  // --- 5. Coverage: deterministic gap check, then corrective passes ---------
  report(onProgress, "covering", "Checking every must-have requirement has a question");
  let passes = 1;
  let coverage = buildCoverageReport(requirements, questions);

  while (coverage.uncoveredMustIds.length && passes < MAX_COVERAGE_PASSES) {
    passes += 1;
    const missing = requirements.filter((requirement) => coverage.uncoveredMustIds.includes(requirement.id));
    report(
      onProgress,
      "covering",
      `Pass ${passes}: filling ${missing.length} uncovered requirement${missing.length === 1 ? "" : "s"}`,
    );

    const missingByCategory = new Map<QuestionCategory, Requirement[]>();
    for (const requirement of missing) {
      const category = categoriesFor(requirement)[0];
      missingByCategory.set(category, [...(missingByCategory.get(category) ?? []), requirement]);
    }

    const filled = await Promise.all(
      [...missingByCategory.entries()].map(([category, categoryRequirements]) =>
        generateQuestionsForCategory(categoryRequirements, category, context),
      ),
    );
    for (const result of filled) {
      // Only keep drafts that actually close a gap, so a pass cannot pad the bank.
      addDrafts(
        result.drafts.filter((draft) => draft.requirement_ids.some((id) => coverage.uncoveredMustIds.includes(id))),
        passes,
      );
    }

    const next = buildCoverageReport(requirements, questions);
    if (next.uncoveredMustIds.length === coverage.uncoveredMustIds.length) {
      // No progress this pass; stop asking and close the gap deterministically.
      coverage = next;
      break;
    }
    coverage = next;
  }

  // Deterministic backstop: a kit must never ship with an uncovered must-have.
  if (coverage.uncoveredMustIds.length) {
    const stillMissing = requirements.filter((requirement) => coverage.uncoveredMustIds.includes(requirement.id));
    for (const requirement of stillMissing) {
      addDrafts(templateQuestionsFor([requirement], categoriesFor(requirement)[0], context), passes);
    }
    warnings.push(
      `${stillMissing.length} requirement${stillMissing.length === 1 ? "" : "s"} needed a fallback question after ${passes} coverage pass${passes === 1 ? "" : "es"}.`,
    );
    coverage = buildCoverageReport(requirements, questions);
  }

  // --- 6. Flashcards --------------------------------------------------------
  report(onProgress, "flashcards", "Building recall flashcards");
  const { drafts: cardDrafts } = await generateFlashcards(requirements, roleDetails.title);
  const flashcards = cardDrafts.map((draft, index) => ({ ...draft, id: `f${index + 1}` }));

  // --- 7. Schedule ----------------------------------------------------------
  report(onProgress, "scheduling", `Allocating the material across ${days} day${days === 1 ? "" : "s"}`);
  const schedule = buildSchedule(requirements, questions, days);

  const config = readLlmConfig();
  const kit: Kit = {
    source: {
      company: companyName,
      company_url: input.company_url,
      role: roleDetails.title,
      location: roleDetails.location,
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: research.pages.map((page) => page.url),
      generation: {
        llm_used: isLlmConfigured() && requirementsFromModel,
        model: config?.model ?? null,
        hiring_page_found: research.hiringPages.length > 0,
        discussion_found: research.discussionPages.length > 0,
      },
    },
    company_brief: brief,
    role: {
      title: roleDetails.title,
      seniority: roleDetails.seniority,
      responsibilities: roleDetails.responsibilities,
      requirements,
      state: "generated",
    },
    questions,
    flashcards,
    schedule: { ...schedule, state: "generated" },
    coverage: {
      uncovered_requirement_ids: coverage.uncoveredMustIds,
      passes,
    },
    warnings: [...new Set(warnings)],
  };

  // --- 8. Validate ----------------------------------------------------------
  report(onProgress, "validating", "Checking the kit against the expected structure");
  assertValidKit(kit);
  report(onProgress, "done", "Kit ready");
  return kit;
}

export { researchCompany, validateCompanyUrl };
