import type { Question, Requirement } from "./types";

export function findUncoveredRequirements(requirements: Requirement[], questions: Question[]): string[] {
  const covered = new Set(questions.flatMap((question) => question.requirement_ids));
  return requirements
    .filter((requirement) => requirement.priority === "must" && !covered.has(requirement.id))
    .map((requirement) => requirement.id);
}

export function validateQuestionReferences(requirements: Requirement[], questions: Question[]): string[] {
  const ids = new Set(requirements.map((requirement) => requirement.id));
  return questions.flatMap((question) => question.requirement_ids.filter((id) => !ids.has(id)));
}
