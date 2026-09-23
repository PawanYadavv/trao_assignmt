/**
 * Step 4 of the pipeline: generate questions for a given requirement *and*
 * category.
 *
 * Each category is a separate call with its own instruction, because "5 years
 * of React" and "mentoring junior engineers" do not produce the same kind of
 * question. What the company's hiring page says is passed in as context, so a
 * company that publishes a take-home plus a system design round produces a
 * different bank from one that publishes nothing.
 */

import type { Question, QuestionCategory, Requirement } from "@/lib/kit/types";
import { looksArchitectural } from "./extract";
import { askForJson } from "./llm";

export interface GenerationContext {
  company: string;
  roleTitle: string;
  seniority: string;
  /** Text of the discovered hiring/interview-process page, if any. */
  hiringProcess: string | null;
  /** Short description of what the company does, if any. */
  companySummary: string | null;
}

export type QuestionDraft = Omit<Question, "id">;

const CATEGORY_INSTRUCTIONS: Record<QuestionCategory, string> = {
  technical: [
    "Write technical interview questions that probe hands-on depth in the listed requirements.",
    "Ask about concrete mechanics, failure modes and trade-offs, not definitions.",
    "A good question cannot be answered by reciting documentation.",
  ].join(" "),
  behavioural: [
    "Write behavioural interview questions about working with people.",
    "Each question must ask for a specific past situation, not a hypothetical or a personality claim.",
    "The answer outline should follow situation, action, outcome and reflection.",
  ].join(" "),
  "system-design": [
    "Write system design questions scoped to the listed requirements.",
    "Each question should name a concrete system to design or a scaling problem to reason about,",
    "and the outline should cover requirements gathering, the main components, the data model, and the trade-off the interviewer is listening for.",
  ].join(" "),
  "company-fit": [
    "Write questions the candidate should be ready for about this specific company and their motivation for the role.",
    "Ground them in what the company actually does and how it says it hires.",
    "Do not invent facts about the company; if the context is thin, ask questions that work without specifics.",
  ].join(" "),
};

function difficultyFor(requirement: Requirement, category: QuestionCategory, seniority: string): 1 | 2 | 3 {
  const senior = /senior|staff|principal|lead/i.test(seniority);
  if (category === "system-design") return 3;
  if (requirement.priority === "nice") return senior ? 2 : 1;
  if (looksArchitectural(requirement.text) || senior) return 3;
  return 2;
}

/**
 * Routes a requirement to the categories it should be questioned in.
 * A technical requirement that talks about scale earns a system-design question
 * as well as a technical one.
 */
export function categoriesFor(requirement: Requirement): QuestionCategory[] {
  if (requirement.kind === "behavioural") return ["behavioural"];
  if (requirement.kind === "domain") return ["company-fit"];
  return looksArchitectural(requirement.text) ? ["technical", "system-design"] : ["technical"];
}

export function groupByCategory(requirements: Requirement[]) {
  const groups = new Map<QuestionCategory, Requirement[]>();
  for (const requirement of requirements) {
    for (const category of categoriesFor(requirement)) {
      const bucket = groups.get(category) ?? [];
      bucket.push(requirement);
      groups.set(category, bucket);
    }
  }
  return groups;
}

// --- Deterministic templates -------------------------------------------------
// Used when no model is configured, and as the guaranteed backstop that closes a
// coverage gap the model left open. Deliberately different per category.

const TECHNICAL_TEMPLATES = [
  (text: string) => ({
    prompt: `Walk through a time you worked hands-on with ${text}. What was the hardest part, and how did you know your solution was correct?`,
    answer_outline: `Name the project and your role. Describe the specific technical obstacle in ${text}, the options you weighed, why you chose one, and how you verified the result.`,
  }),
  (text: string) => ({
    prompt: `Where does ${text} usually go wrong in production, and how would you catch it before a user does?`,
    answer_outline: `Give two concrete failure modes, the signal that surfaces each one, and the guardrail (test, alert, review step) you would put in place.`,
  }),
  (text: string) => ({
    prompt: `How would you explain your approach to ${text} to a teammate who has never used it, and what trade-off would you warn them about?`,
    answer_outline: `Lead with the mental model, then one worked example, then the trade-off you have personally been burned by.`,
  }),
];

const BEHAVIOURAL_TEMPLATES = [
  (text: string) => ({
    prompt: `Tell me about a specific time that required ${text}. What did you do, and what happened?`,
    answer_outline: `Situation and stakes, the action you personally took, the measurable outcome, and what you would do differently now.`,
  }),
  (text: string) => ({
    prompt: `Describe a time ${text} did not go well. What did you misjudge?`,
    answer_outline: `Be honest about the misread, show the correction you made, and finish with the habit you changed as a result.`,
  }),
];

const SYSTEM_DESIGN_TEMPLATES = [
  (text: string) => ({
    prompt: `Design a system that satisfies: ${text}. Start by stating your assumptions and the constraints you would confirm with the interviewer.`,
    answer_outline: `Clarify functional and non-functional requirements, sketch the components and data flow, pick a data model, then name the bottleneck and how you would scale past it.`,
  }),
  (text: string) => ({
    prompt: `Your design for ${text} works at current load. What breaks first at ten times the traffic, and what would you change?`,
    answer_outline: `Identify the first saturation point, quantify it roughly, propose one change, and state what that change costs you in complexity or consistency.`,
  }),
];

function companyFitTemplates(context: GenerationContext) {
  const company = context.company || "this company";
  const templates = [
    () => ({
      prompt: `Why ${company}, and why this role now?`,
      answer_outline: context.companySummary
        ? `Connect your motivation to what they actually do: ${context.companySummary.slice(0, 180)}. Then link it to a concrete thing you want to build next.`
        : `Public information about ${company} is thin, so anchor the answer in the role itself and ask them what success looks like in the first six months.`,
    }),
    () => ({
      prompt: `What would you want to understand about how ${company} works in your first month?`,
      answer_outline: `Name two or three specific unknowns (ownership model, release cadence, how decisions get made) and say why each would change how you work.`,
    }),
  ];

  if (context.hiringProcess) {
    templates.unshift(() => ({
      prompt: `${company} publishes how it interviews. Which stage of that process would stretch you most, and how are you preparing for it?`,
      answer_outline: `Reference the published stages, pick the one that is genuinely hardest for you, and describe the concrete preparation you are doing rather than claiming it is easy.`,
    }));
  }
  return templates;
}

function templateQuestion(
  requirement: Requirement,
  category: QuestionCategory,
  context: GenerationContext,
  variant: number,
): QuestionDraft {
  const text = requirement.text.replace(/\.$/, "");
  const pick = <T,>(list: T[]) => list[variant % list.length];

  const body =
    category === "behavioural"
      ? pick(BEHAVIOURAL_TEMPLATES)(text)
      : category === "system-design"
        ? pick(SYSTEM_DESIGN_TEMPLATES)(text)
        : category === "company-fit"
          ? pick(companyFitTemplates(context))()
          : pick(TECHNICAL_TEMPLATES)(text);

  return {
    requirement_ids: [requirement.id],
    category,
    prompt: body.prompt,
    answer_outline: body.answer_outline,
    difficulty: difficultyFor(requirement, category, context.seniority),
    state: "generated",
  };
}

export function templateQuestionsFor(
  requirements: Requirement[],
  category: QuestionCategory,
  context: GenerationContext,
): QuestionDraft[] {
  return requirements.map((requirement, index) => templateQuestion(requirement, category, context, index));
}

// --- Model-backed generation -------------------------------------------------

function parseDrafts(
  value: unknown,
  requirements: Requirement[],
  category: QuestionCategory,
  context: GenerationContext,
): QuestionDraft[] | null {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { questions?: unknown })?.questions)
      ? (value as { questions: unknown[] }).questions
      : null;
  if (!list) return null;

  const validIds = new Set(requirements.map((requirement) => requirement.id));
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));

  const drafts = list.flatMap((item): QuestionDraft[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    const outline = typeof record.answer_outline === "string" ? record.answer_outline.trim() : "";
    if (prompt.length < 12 || outline.length < 12) return [];

    const ids = Array.isArray(record.requirement_ids)
      ? record.requirement_ids.filter((id): id is string => typeof id === "string" && validIds.has(id))
      : [];
    // A question that claims to cover nothing we asked about is not useful for
    // coverage, so anchor it to the group's first requirement instead.
    const requirementIds = ids.length ? ids : category === "company-fit" ? [] : [requirements[0].id];

    const anchor = byId.get(requirementIds[0] ?? "") ?? requirements[0];
    const rawDifficulty = Number(record.difficulty);
    const difficulty = ([1, 2, 3] as const).includes(rawDifficulty as 1 | 2 | 3)
      ? (rawDifficulty as 1 | 2 | 3)
      : difficultyFor(anchor, category, context.seniority);

    return [{
      requirement_ids: requirementIds,
      category,
      prompt: prompt.slice(0, 400),
      answer_outline: outline.slice(0, 800),
      difficulty,
      state: "generated",
    }];
  });

  return drafts.length ? drafts : null;
}

function contextBlocks(context: GenerationContext) {
  const blocks = [];
  if (context.companySummary) {
    blocks.push({ label: "company_summary", body: context.companySummary.slice(0, 2500) });
  }
  if (context.hiringProcess) {
    blocks.push({ label: "published_hiring_process", body: context.hiringProcess.slice(0, 4000) });
  }
  return blocks;
}

/**
 * One call per category. Falls back to the category's templates on any failure,
 * so a rate-limited provider degrades the wording rather than the structure.
 */
export async function generateQuestionsForCategory(
  requirements: Requirement[],
  category: QuestionCategory,
  context: GenerationContext,
  perRequirement = 1,
): Promise<{ drafts: QuestionDraft[]; usedModel: boolean }> {
  if (!requirements.length) return { drafts: [], usedModel: false };

  const requirementList = requirements
    .map((requirement) => `${requirement.id} (${requirement.priority}): ${requirement.text}`)
    .join("\n");

  try {
    const drafts = await askForJson<QuestionDraft[]>({
      instruction: [
        CATEGORY_INSTRUCTIONS[category],
        `The role is ${context.roleTitle} (${context.seniority}) at ${context.company}.`,
        `Write ${perRequirement} question(s) for each requirement listed below and set requirement_ids to the ids it covers.`,
        context.hiringProcess
          ? "The company's own published hiring process is included; shape the questions around the stages it describes."
          : "No hiring process was found for this company, so do not speculate about their interview format.",
        "Use difficulty 1 to 3.",
        "",
        "Requirements:",
        requirementList,
      ].join("\n"),
      untrusted: contextBlocks(context),
      schemaHint:
        'Respond with {"questions": [{"requirement_ids": string[], "prompt": string, "answer_outline": string, "difficulty": number}]}.',
      parse: (value) => parseDrafts(value, requirements, category, context),
      maxTokens: 2000,
    });

    if (drafts) return { drafts, usedModel: true };
  } catch {
    // fall through to templates
  }

  return { drafts: templateQuestionsFor(requirements, category, context), usedModel: false };
}
