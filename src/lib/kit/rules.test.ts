import assert from "node:assert/strict";
import test from "node:test";
import { findUncoveredRequirements } from "./coverage";
import { buildSchedule } from "./schedule";
import { validateKit } from "./validate";
import { createSampleKit } from "./sample";

test("coverage reports only uncovered must requirements", () => {
  const kit = createSampleKit();
  assert.deepEqual(findUncoveredRequirements(kit.role.requirements, kit.questions), []);
  assert.deepEqual(findUncoveredRequirements([{ id: "r1", text: "React", kind: "technical", priority: "must" }], []), ["r1"]);
});

test("schedule has exactly the requested number of days and stable question references", () => {
  const kit = createSampleKit();
  const schedule = buildSchedule(kit.role.requirements, kit.questions, 3);
  assert.equal(schedule.days.length, 3);
  assert.deepEqual(schedule.days.flatMap((day) => day.question_ids).sort(), kit.questions.map((question) => question.id).sort());
  assert.ok(schedule.days.every((day) => Number.isInteger(day.minutes)));
});

test("sample kit satisfies structure validation", () => {
  assert.deepEqual(validateKit(createSampleKit()), []);
});
