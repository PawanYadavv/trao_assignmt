import assert from "node:assert/strict";
import test from "node:test";
import { buildSchedule, clampDays, prioritiseQuestions, splitSizes } from "./schedule";
import type { Question, Requirement } from "./types";

function requirement(id: string, priority: "must" | "nice" = "must"): Requirement {
  return { id, text: `requirement ${id}`, kind: "technical", priority };
}

function question(id: string, requirementId: string, difficulty: 1 | 2 | 3 = 2): Question {
  return {
    id,
    requirement_ids: [requirementId],
    category: "technical",
    prompt: `prompt ${id}`,
    answer_outline: `outline ${id}`,
    difficulty,
  };
}

test("splitSizes front-loads the remainder so earlier days carry more", () => {
  assert.deepEqual(splitSizes(7, 3), [3, 2, 2]);
  assert.deepEqual(splitSizes(6, 3), [2, 2, 2]);
  assert.deepEqual(splitSizes(1, 1), [1]);
});

test("clampDays keeps the schedule inside 1..60", () => {
  assert.equal(clampDays(0), 1);
  assert.equal(clampDays(1), 1);
  assert.equal(clampDays(60), 60);
  assert.equal(clampDays(900), 60);
  assert.equal(clampDays(5.8), 5);
  assert.equal(clampDays(Number.NaN), 1);
});

test("the schedule spans exactly the days requested", () => {
  const requirements = [requirement("r1"), requirement("r2")];
  const questions = [question("q1", "r1"), question("q2", "r2")];

  for (const days of [1, 2, 3, 7, 14, 30, 60]) {
    const schedule = buildSchedule(requirements, questions, days);
    assert.equal(schedule.days_available, days);
    assert.equal(schedule.days.length, days);
    assert.deepEqual(
      schedule.days.map((day) => day.day),
      Array.from({ length: days }, (_, index) => index + 1),
    );
  }
});

test("every day has a focus, questions and a positive integer duration", () => {
  // 60 days against 2 questions is the case that used to leave 58 empty days.
  const requirements = [requirement("r1"), requirement("r2")];
  const questions = [question("q1", "r1", 3), question("q2", "r2", 1)];
  const schedule = buildSchedule(requirements, questions, 60);

  for (const day of schedule.days) {
    assert.ok(day.focus.trim().length > 0, `day ${day.day} has no focus`);
    assert.ok(day.question_ids.length > 0, `day ${day.day} has no questions`);
    assert.ok(Number.isInteger(day.minutes), `day ${day.day} has non-integer minutes`);
    assert.ok(day.minutes > 0, `day ${day.day} has no time allocated`);
  }
});

test("every question is scheduled at least once when there are more questions than days", () => {
  const requirements = [requirement("r1"), requirement("r2"), requirement("r3")];
  const questions = Array.from({ length: 11 }, (_, index) =>
    question(`q${index + 1}`, requirements[index % 3].id, ((index % 3) + 1) as 1 | 2 | 3),
  );

  const schedule = buildSchedule(requirements, questions, 3);
  const scheduled = schedule.days.flatMap((day) => day.question_ids);
  assert.deepEqual([...new Set(scheduled)].sort(), questions.map((q) => q.id).sort());
});

test("every must-have requirement appears somewhere in the schedule", () => {
  const requirements = [requirement("r1"), requirement("r2", "nice"), requirement("r3")];
  const questions = [question("q1", "r1"), question("q2", "r2"), question("q3", "r3")];
  const schedule = buildSchedule(requirements, questions, 4);

  const scheduledQuestionIds = new Set(schedule.days.flatMap((day) => day.question_ids));
  for (const must of requirements.filter((entry) => entry.priority === "must")) {
    const covered = questions.some(
      (entry) => entry.requirement_ids.includes(must.id) && scheduledQuestionIds.has(entry.id),
    );
    assert.ok(covered, `${must.id} never appears in the schedule`);
  }
});

test("harder, higher-priority material is ordered before easier nice-to-haves", () => {
  const requirements = [requirement("r1", "nice"), requirement("r2")];
  const questions = [question("q1", "r1", 3), question("q2", "r2", 1)];

  const ordered = prioritiseQuestions(requirements, questions);
  assert.equal(ordered[0].id, "q2", "a must-have outranks a harder nice-to-have");

  const musts = [requirement("r1"), requirement("r2")];
  const mixed = [question("q1", "r1", 1), question("q2", "r2", 3)];
  assert.equal(prioritiseQuestions(musts, mixed)[0].id, "q2", "the harder must-have comes first");
});

test("day one carries the hardest must-have material", () => {
  const requirements = [requirement("r1"), requirement("r2", "nice")];
  const questions = [question("q1", "r2", 1), question("q2", "r1", 3)];
  const schedule = buildSchedule(requirements, questions, 2);
  assert.ok(schedule.days[0].question_ids.includes("q2"));
});

test("a kit with no questions still produces the requested number of days", () => {
  const schedule = buildSchedule([], [], 5);
  assert.equal(schedule.days.length, 5);
  assert.ok(schedule.days.every((day) => Number.isInteger(day.minutes) && day.minutes > 0));
});
