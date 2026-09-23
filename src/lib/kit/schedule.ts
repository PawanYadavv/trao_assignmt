/**
 * Schedule allocation is arithmetic, so it lives in code rather than a prompt.
 *
 * Rules the allocator guarantees:
 *  - the schedule spans exactly the number of days requested (clamped to 1..60)
 *  - every question is scheduled at least once, so every must-have requirement
 *    that has a question appears in the plan
 *  - harder and higher-priority material lands earlier
 *  - every day has a focus, at least one question and an integer minute count
 *
 * When there are more days than questions the extra days become spaced review
 * days that revisit earlier material hardest-first, rather than empty days.
 */

import type { Question, Requirement, ScheduleDay } from "./types";

export const MIN_DAYS = 1;
export const MAX_DAYS = 60;

/** Minutes budgeted for one question, by difficulty. */
const MINUTES_BY_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 10, 2: 15, 3: 25 };
const REVIEW_MINUTES_BY_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 5, 2: 8, 3: 12 };
const DAY_OVERHEAD_MINUTES = 10;
const MAX_DAY_MINUTES = 180;

export function clampDays(daysAvailable: number) {
  const requested = Number.isFinite(daysAvailable) ? Math.floor(daysAvailable) : MIN_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, requested));
}

const CATEGORY_LABEL: Record<Question["category"], string> = {
  technical: "Technical depth",
  behavioural: "Behavioural stories",
  "system-design": "System design",
  "company-fit": "Company and motivation",
};

/**
 * Orders questions so the hardest, highest-priority material is studied first.
 * Must-haves outrank nice-to-haves, then difficulty descending, then the
 * requirement order from the description so the result is stable.
 */
export function prioritiseQuestions(requirements: Requirement[], questions: Question[]): Question[] {
  const priorityOf = new Map(requirements.map((requirement) => [requirement.id, requirement.priority]));
  const orderOf = new Map(requirements.map((requirement, index) => [requirement.id, index]));

  const rank = (question: Question) => {
    const isMust = question.requirement_ids.some((id) => priorityOf.get(id) === "must");
    const firstIndex = Math.min(
      ...question.requirement_ids.map((id) => orderOf.get(id) ?? Number.MAX_SAFE_INTEGER),
      Number.MAX_SAFE_INTEGER,
    );
    return { isMust, firstIndex };
  };

  return [...questions].sort((left, right) => {
    const leftRank = rank(left);
    const rightRank = rank(right);
    if (leftRank.isMust !== rightRank.isMust) return leftRank.isMust ? -1 : 1;
    if (left.difficulty !== right.difficulty) return right.difficulty - left.difficulty;
    if (leftRank.firstIndex !== rightRank.firstIndex) return leftRank.firstIndex - rightRank.firstIndex;
    return left.id.localeCompare(right.id, undefined, { numeric: true });
  });
}

/**
 * Splits `total` items across `buckets` groups, front-loading the remainder so
 * earlier days carry slightly more work than later ones.
 */
export function splitSizes(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const remainder = total % buckets;
  return Array.from({ length: buckets }, (_, index) => base + (index < remainder ? 1 : 0));
}

function focusFor(questions: Question[], requirements: Requirement[], isReview: boolean): string {
  if (!questions.length) return isReview ? "Review" : "Preparation";

  const counts = new Map<Question["category"], number>();
  for (const question of questions) {
    counts.set(question.category, (counts.get(question.category) ?? 0) + 1);
  }
  const [dominant] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];

  const requirementText = requirements.find((requirement) =>
    questions.some((question) => question.requirement_ids.includes(requirement.id)),
  )?.text;

  const label = CATEGORY_LABEL[dominant];
  const detail = requirementText ? `: ${requirementText.slice(0, 60)}` : "";
  return `${isReview ? "Review - " : ""}${label}${detail}`;
}

function minutesFor(questions: Question[], isReview: boolean) {
  const table = isReview ? REVIEW_MINUTES_BY_DIFFICULTY : MINUTES_BY_DIFFICULTY;
  const total = questions.reduce((sum, question) => sum + table[question.difficulty], DAY_OVERHEAD_MINUTES);
  return Math.max(DAY_OVERHEAD_MINUTES, Math.min(MAX_DAY_MINUTES, Math.round(total)));
}

export function buildSchedule(requirements: Requirement[], questions: Question[], daysAvailable: number) {
  const days = clampDays(daysAvailable);
  const ordered = prioritiseQuestions(requirements, questions);

  if (!ordered.length) {
    return {
      days_available: days,
      days: Array.from({ length: days }, (_, index) => ({
        day: index + 1,
        focus: "Re-read the job description and note your own examples",
        question_ids: [],
        minutes: 30,
      })),
    };
  }

  const buckets: ScheduleDay[] = [];

  if (ordered.length >= days) {
    // More questions than days: give each day a contiguous slice of the
    // priority-ordered list, so day 1 gets the hardest must-haves.
    const sizes = splitSizes(ordered.length, days);
    let cursor = 0;
    for (let index = 0; index < days; index += 1) {
      const slice = ordered.slice(cursor, cursor + sizes[index]);
      cursor += sizes[index];
      buckets.push({
        day: index + 1,
        focus: focusFor(slice, requirements, false),
        question_ids: slice.map((question) => question.id),
        minutes: minutesFor(slice, false),
      });
    }
  } else {
    // More days than questions: cover everything first, then use the remaining
    // days for spaced review, revisiting the hardest material most often.
    const firstPassDays = ordered.length;
    for (let index = 0; index < firstPassDays; index += 1) {
      const slice = [ordered[index]];
      buckets.push({
        day: index + 1,
        focus: focusFor(slice, requirements, false),
        question_ids: slice.map((question) => question.id),
        minutes: minutesFor(slice, false),
      });
    }

    const reviewDays = days - firstPassDays;
    const reviewPool = [...ordered].sort((left, right) => right.difficulty - left.difficulty);
    const perReviewDay = Math.max(1, Math.ceil(ordered.length / Math.max(1, reviewDays)));

    for (let index = 0; index < reviewDays; index += 1) {
      const start = (index * perReviewDay) % reviewPool.length;
      const slice = Array.from({ length: Math.min(perReviewDay, reviewPool.length) }, (_, offset) =>
        reviewPool[(start + offset) % reviewPool.length],
      );
      buckets.push({
        day: firstPassDays + index + 1,
        focus: focusFor(slice, requirements, true),
        question_ids: [...new Set(slice.map((question) => question.id))],
        minutes: minutesFor(slice, true),
      });
    }
  }

  // The last day before an interview is for consolidation, not new material.
  const lastDay = buckets[buckets.length - 1];
  if (days > 1 && lastDay) {
    lastDay.focus = `Final review - ${lastDay.focus.replace(/^Review - /, "")}`;
  }

  return { days_available: days, days: buckets };
}
