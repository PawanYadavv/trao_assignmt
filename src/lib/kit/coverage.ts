/**
 * Coverage is deterministic on purpose.
 *
 * The brief is explicit that comparing extracted requirements against generated
 * questions is the code's decision, not the model's. Nothing in this file talks
 * to a model or the network: given requirements and questions it answers, by set
 * arithmetic, which requirements nothing asks about.
 */

import type { Question, Requirement } from "./types";

export interface CoverageReport {
  /** Must-have requirements with no question against them. These block shipping. */
  uncoveredMustIds: string[];
  /** Nice-to-have requirements with no question. Reported, but not blocking. */
  uncoveredNiceIds: string[];
  /** requirement_ids on questions that do not match any requirement. */
  danglingRequirementIds: string[];
  coveredCount: number;
  totalCount: number;
}

function coveredIds(questions: Question[]) {
  return new Set(questions.flatMap((question) => question.requirement_ids));
}

export function buildCoverageReport(requirements: Requirement[], questions: Question[]): CoverageReport {
  const covered = coveredIds(questions);
  const known = new Set(requirements.map((requirement) => requirement.id));

  const uncoveredMustIds: string[] = [];
  const uncoveredNiceIds: string[] = [];
  for (const requirement of requirements) {
    if (covered.has(requirement.id)) continue;
    if (requirement.priority === "must") uncoveredMustIds.push(requirement.id);
    else uncoveredNiceIds.push(requirement.id);
  }

  const dangling = [...new Set(questions.flatMap((question) => question.requirement_ids))].filter((id) => !known.has(id));

  return {
    uncoveredMustIds,
    uncoveredNiceIds,
    danglingRequirementIds: dangling,
    coveredCount: requirements.filter((requirement) => covered.has(requirement.id)).length,
    totalCount: requirements.length,
  };
}

/** Must-have requirements with no question against them. */
export function findUncoveredRequirements(requirements: Requirement[], questions: Question[]): string[] {
  return buildCoverageReport(requirements, questions).uncoveredMustIds;
}

/** Every requirement, regardless of priority, that no question references. */
export function findAllUncoveredRequirements(requirements: Requirement[], questions: Question[]): string[] {
  const report = buildCoverageReport(requirements, questions);
  return [...report.uncoveredMustIds, ...report.uncoveredNiceIds];
}

export function validateQuestionReferences(requirements: Requirement[], questions: Question[]): string[] {
  return buildCoverageReport(requirements, questions).danglingRequirementIds;
}
