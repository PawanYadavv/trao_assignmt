import type { Question, Requirement } from "./types";

const MIN_DAYS = 1;
const MAX_DAYS = 60;

export function buildSchedule(requirements: Requirement[], questions: Question[], daysAvailable: number) {
  const days = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(daysAvailable)));
  const priority = new Map(requirements.map((requirement) => [requirement.id, requirement.priority]));
  const ordered = [...questions].sort((left, right) => {
    const leftMust = left.requirement_ids.some((id) => priority.get(id) === "must");
    const rightMust = right.requirement_ids.some((id) => priority.get(id) === "must");
    return Number(rightMust) - Number(leftMust) || right.difficulty - left.difficulty;
  });
  const buckets = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    focus: index === 0 ? "Core requirements" : index === days - 1 ? "Review and confidence" : "Targeted practice",
    question_ids: [] as string[],
    minutes: 0,
  }));

  ordered.forEach((question, index) => {
    const bucket = buckets[index % days];
    bucket.question_ids.push(question.id);
    bucket.minutes += 15;
  });

  return { days_available: days, days: buckets };
}
