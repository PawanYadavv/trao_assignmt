import { findUncoveredRequirements, validateQuestionReferences } from "./coverage";
import type { Kit } from "./types";

export function validateKit(kit: Kit): string[] {
  const errors: string[] = [];
  const requirementIds = new Set(kit.role.requirements.map((requirement) => requirement.id));
  const questionIds = new Set(kit.questions.map((question) => question.id));

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    errors.push("Schedule must contain exactly days_available days.");
  }
  if (findUncoveredRequirements(kit.role.requirements, kit.questions).length > 0) {
    errors.push("Every must-have requirement must be covered by a question.");
  }
  errors.push(...validateQuestionReferences(kit.role.requirements, kit.questions).map((id) => `Unknown requirement reference: ${id}`));
  kit.schedule.days.forEach((day) => day.question_ids.forEach((id) => {
    if (!questionIds.has(id)) errors.push(`Unknown scheduled question: ${id}`);
  }));
  kit.flashcards.forEach((card) => card.requirement_ids.forEach((id) => {
    if (!requirementIds.has(id)) errors.push(`Unknown flashcard requirement: ${id}`);
  }));
  return errors;
}
