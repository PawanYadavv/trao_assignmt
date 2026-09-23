import assert from "node:assert/strict";
import test from "node:test";
import { buildCoverageReport, findUncoveredRequirements, validateQuestionReferences } from "./coverage";
import type { Question, Requirement } from "./types";

const requirements: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must" },
  { id: "r3", text: "Kubernetes", kind: "technical", priority: "nice" },
];

function question(id: string, requirementIds: string[]): Question {
  return {
    id,
    requirement_ids: requirementIds,
    category: "technical",
    prompt: `prompt ${id}`,
    answer_outline: `outline ${id}`,
    difficulty: 2,
  };
}

test("an uncovered must-have is reported", () => {
  const report = buildCoverageReport(requirements, [question("q1", ["r1"])]);
  assert.deepEqual(report.uncoveredMustIds, ["r2"]);
  assert.deepEqual(report.uncoveredNiceIds, ["r3"]);
  assert.equal(report.coveredCount, 1);
  assert.equal(report.totalCount, 3);
});

test("only must-haves block, nice-to-haves are reported separately", () => {
  const questions = [question("q1", ["r1"]), question("q2", ["r2"])];
  assert.deepEqual(findUncoveredRequirements(requirements, questions), []);
  assert.deepEqual(buildCoverageReport(requirements, questions).uncoveredNiceIds, ["r3"]);
});

test("one question covering several requirements closes all of them", () => {
  assert.deepEqual(findUncoveredRequirements(requirements, [question("q1", ["r1", "r2", "r3"])]), []);
});

test("no questions means every must-have is uncovered", () => {
  assert.deepEqual(findUncoveredRequirements(requirements, []), ["r1", "r2"]);
});

test("no requirements is vacuously covered", () => {
  assert.deepEqual(findUncoveredRequirements([], [question("q1", [])]), []);
});

test("references to requirements that do not exist are reported", () => {
  const questions = [question("q1", ["r1", "r9"])];
  assert.deepEqual(validateQuestionReferences(requirements, questions), ["r9"]);
});

test("a question with no requirement_ids covers nothing", () => {
  const report = buildCoverageReport(requirements, [question("q1", [])]);
  assert.deepEqual(report.uncoveredMustIds, ["r1", "r2"]);
});
