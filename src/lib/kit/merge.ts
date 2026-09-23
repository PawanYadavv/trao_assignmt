/**
 * Regeneration merge rules.
 *
 * Every editable item carries a `state`:
 *
 *   generated  produced by the pipeline - regeneration may replace it
 *   edited     the user changed it      - regeneration must keep it
 *   authored   the user wrote it        - regeneration must keep it
 *   pinned     the user locked it       - regeneration must keep it
 *
 * Regenerating a section therefore only ever replaces the `generated` items
 * *inside that section*. Nothing outside the section is touched, and a question
 * the user wrote or edited by hand survives a regeneration of its category,
 * keeping its position in the list.
 *
 * These are pure functions over a kit so the rule is testable without a
 * database, a model or a browser.
 */

import type { Flashcard, ItemState, Kit, Question, QuestionCategory } from "./types";
import { isProtected } from "./types";
import { buildCoverageReport } from "./coverage";
import { buildSchedule } from "./schedule";

export type RegenerableSection = "company_brief" | "schedule" | QuestionCategory;

export const REGENERABLE_SECTIONS: RegenerableSection[] = [
  "company_brief",
  "schedule",
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
];

export function isRegenerableSection(value: string): value is RegenerableSection {
  return (REGENERABLE_SECTIONS as string[]).includes(value);
}

/** Next free `q<n>` id for a kit, so regeneration never collides with existing ids. */
export function nextQuestionId(questions: Question[]): (offset?: number) => string {
  const highest = questions.reduce((max, question) => {
    const parsed = Number(/^q(\d+)$/.exec(question.id)?.[1] ?? 0);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return (offset = 0) => `q${highest + 1 + offset}`;
}

export function nextFlashcardId(flashcards: Flashcard[]): (offset?: number) => string {
  const highest = flashcards.reduce((max, card) => {
    const parsed = Number(/^f(\d+)$/.exec(card.id)?.[1] ?? 0);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return (offset = 0) => `f${highest + 1 + offset}`;
}

/**
 * Replaces the generated questions of one category with freshly generated ones,
 * leaving every other category and every protected question untouched.
 *
 * The new questions are spliced in where the first replaced question sat, so the
 * list does not reshuffle under the user.
 */
export function mergeRegeneratedCategory(
  existing: Question[],
  category: QuestionCategory,
  incoming: Omit<Question, "id">[],
): Question[] {
  const kept: Question[] = [];
  let insertAt = -1;

  for (const question of existing) {
    if (question.category !== category || isProtected(question.state)) {
      kept.push(question);
      continue;
    }
    // A generated question in the target category: drop it, and remember where.
    if (insertAt < 0) insertAt = kept.length;
  }

  const makeId = nextQuestionId(existing);
  const replacements = incoming.map((draft, index) => ({
    ...draft,
    id: makeId(index),
    state: "generated" as ItemState,
  }));

  const index = insertAt >= 0 ? insertAt : kept.length;
  return [...kept.slice(0, index), ...replacements, ...kept.slice(index)];
}

/** Same rule for flashcards. */
export function mergeRegeneratedFlashcards(
  existing: Flashcard[],
  incoming: Omit<Flashcard, "id">[],
): Flashcard[] {
  const kept = existing.filter((card) => isProtected(card.state));
  const makeId = nextFlashcardId(existing);
  const replacements = incoming.map((draft, index) => ({
    ...draft,
    id: makeId(index),
    state: "generated" as ItemState,
  }));
  return [...replacements, ...kept];
}

/**
 * Recomputes everything that is derived from the questions: coverage, and the
 * schedule (unless the user has pinned it). Called after any edit or
 * regeneration so the kit stays internally consistent.
 */
export function reconcileKit(kit: Kit): Kit {
  const questionIds = new Set(kit.questions.map((question) => question.id));
  const requirementIds = new Set(kit.role.requirements.map((requirement) => requirement.id));

  // Drop references the user's edits may have invalidated.
  const questions = kit.questions.map((question) => ({
    ...question,
    requirement_ids: question.requirement_ids.filter((id) => requirementIds.has(id)),
  }));
  const flashcards = kit.flashcards.map((card) => ({
    ...card,
    requirement_ids: card.requirement_ids.filter((id) => requirementIds.has(id)),
  }));

  const coverage = buildCoverageReport(kit.role.requirements, questions);

  // A pinned schedule is the user's own plan: keep it, but prune any question
  // they have since deleted so the kit still validates.
  const schedule = kit.schedule.state === "pinned"
    ? {
        ...kit.schedule,
        days: kit.schedule.days.map((day) => ({
          ...day,
          question_ids: day.question_ids.filter((id) => questionIds.has(id)),
        })),
      }
    : { ...buildSchedule(kit.role.requirements, questions, kit.schedule.days_available), state: kit.schedule.state };

  return {
    ...kit,
    questions,
    flashcards,
    schedule,
    coverage: { ...kit.coverage, uncovered_requirement_ids: coverage.uncoveredMustIds },
  };
}

/**
 * Applies a user edit, marking the item as `edited` so later regenerations
 * leave it alone.
 */
export function applyQuestionEdit(kit: Kit, id: string, patch: Partial<Question>): Kit {
  return reconcileKit({
    ...kit,
    questions: kit.questions.map((question) =>
      question.id === id
        ? { ...question, ...patch, id: question.id, state: question.state === "authored" ? "authored" : "edited" }
        : question,
    ),
  });
}

export function applyFlashcardEdit(kit: Kit, id: string, patch: Partial<Flashcard>): Kit {
  return reconcileKit({
    ...kit,
    flashcards: kit.flashcards.map((card) =>
      card.id === id
        ? { ...card, ...patch, id: card.id, state: card.state === "authored" ? "authored" : "edited" }
        : card,
    ),
  });
}

/** Moves a question to a new index, and optionally into a different category. */
export function moveQuestion(kit: Kit, id: string, toIndex: number, toCategory?: QuestionCategory): Kit {
  const from = kit.questions.findIndex((question) => question.id === id);
  if (from < 0) return kit;

  const questions = [...kit.questions];
  const [moved] = questions.splice(from, 1);
  const updated: Question = toCategory && toCategory !== moved.category
    ? { ...moved, category: toCategory, state: moved.state === "authored" ? "authored" : "edited" }
    : moved;

  const clamped = Math.max(0, Math.min(questions.length, toIndex));
  questions.splice(clamped, 0, updated);
  return reconcileKit({ ...kit, questions });
}
