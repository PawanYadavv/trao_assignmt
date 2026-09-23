import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQuestionEdit,
  mergeRegeneratedCategory,
  moveQuestion,
  nextQuestionId,
  reconcileKit,
} from "./merge";
import { createSampleKit } from "./sample";
import { validateKit } from "./validate";
import type { ItemState, Question } from "./types";

function question(id: string, state: ItemState, prompt = `prompt ${id}`): Question {
  return {
    id,
    requirement_ids: ["r1"],
    category: "technical",
    prompt,
    answer_outline: `outline ${id}`,
    difficulty: 2,
    state,
  };
}

const draft = (prompt: string) => ({
  requirement_ids: ["r1"],
  category: "technical" as const,
  prompt,
  answer_outline: "fresh outline",
  difficulty: 2 as const,
});

test("regenerating a category replaces generated questions", () => {
  const existing = [question("q1", "generated"), question("q2", "generated")];
  const merged = mergeRegeneratedCategory(existing, "technical", [draft("brand new")]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].prompt, "brand new");
  assert.equal(merged[0].state, "generated");
});

test("an edited question survives a regeneration of its category", () => {
  const existing = [question("q1", "generated"), question("q2", "edited", "my own wording")];
  const merged = mergeRegeneratedCategory(existing, "technical", [draft("replacement")]);

  const kept = merged.find((entry) => entry.id === "q2");
  assert.ok(kept, "the edited question was discarded");
  assert.equal(kept.prompt, "my own wording");
  assert.equal(kept.state, "edited");
});

test("questions the user wrote or pinned also survive", () => {
  const existing = [question("q1", "authored", "mine"), question("q2", "pinned", "kept"), question("q3", "generated")];
  const merged = mergeRegeneratedCategory(existing, "technical", [draft("replacement")]);

  assert.deepEqual(
    merged.map((entry) => entry.prompt).sort(),
    ["kept", "mine", "replacement"].sort(),
  );
});

test("regenerating one category leaves the others untouched", () => {
  const behavioural: Question = { ...question("q9", "generated"), category: "behavioural", prompt: "untouched" };
  const existing = [question("q1", "generated"), behavioural];
  const merged = mergeRegeneratedCategory(existing, "technical", [draft("replacement")]);

  const survivor = merged.find((entry) => entry.id === "q9");
  assert.ok(survivor);
  assert.equal(survivor.prompt, "untouched");
  assert.equal(survivor.category, "behavioural");
});

test("regenerated questions are spliced in where the old ones were", () => {
  const first: Question = { ...question("q1", "pinned", "top"), category: "behavioural" };
  const existing = [first, question("q2", "generated"), question("q3", "edited", "bottom")];
  const merged = mergeRegeneratedCategory(existing, "technical", [draft("replacement")]);

  assert.deepEqual(merged.map((entry) => entry.prompt), ["top", "replacement", "bottom"]);
});

test("regenerated ids never collide with existing ones", () => {
  const existing = [question("q1", "edited"), question("q2", "generated"), question("q7", "pinned")];
  const merged = mergeRegeneratedCategory(existing, "technical", [draft("a"), draft("b")]);

  const ids = merged.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, `ids collided: ${ids.join(", ")}`);
  assert.equal(nextQuestionId(existing)(), "q8");
});

test("editing a question marks it edited and keeps its id", () => {
  const kit = createSampleKit();
  const edited = applyQuestionEdit(kit, "q1", { prompt: "reworded" });
  const target = edited.questions.find((entry) => entry.id === "q1")!;

  assert.equal(target.prompt, "reworded");
  assert.equal(target.state, "edited");
  assert.deepEqual(validateKit(edited), []);
});

test("editing a question the user wrote keeps it marked as theirs", () => {
  const kit = createSampleKit();
  kit.questions.push(question("q4", "authored"));
  const edited = applyQuestionEdit(kit, "q4", { prompt: "changed again" });
  assert.equal(edited.questions.find((entry) => entry.id === "q4")!.state, "authored");
});

test("moving a question to another category marks it edited so regeneration spares it", () => {
  const kit = createSampleKit();
  const moved = moveQuestion(kit, "q1", 0, "system-design");
  const target = moved.questions.find((entry) => entry.id === "q1")!;

  assert.equal(target.category, "system-design");
  assert.equal(target.state, "edited");
  assert.deepEqual(validateKit(moved), []);
});

test("reordering keeps every question and leaves the kit valid", () => {
  const kit = createSampleKit();
  const moved = moveQuestion(kit, "q3", 0);

  assert.equal(moved.questions[0].id, "q3");
  assert.deepEqual(moved.questions.map((entry) => entry.id).sort(), ["q1", "q2", "q3"]);
  assert.deepEqual(validateKit(moved), []);
});

test("reconciling after a deletion prunes dangling schedule references", () => {
  const kit = createSampleKit();
  const reduced = reconcileKit({ ...kit, questions: kit.questions.filter((entry) => entry.id !== "q3") });

  const scheduled = reduced.schedule.days.flatMap((day) => day.question_ids);
  assert.ok(!scheduled.includes("q3"));
  assert.deepEqual(validateKit(reduced), []);
});

test("reconciling recomputes coverage after a question is removed", () => {
  const kit = createSampleKit();
  const reduced = reconcileKit({
    ...kit,
    questions: kit.questions.filter((entry) => !entry.requirement_ids.includes("r2")),
  });
  assert.deepEqual(reduced.coverage.uncovered_requirement_ids, ["r2"]);
});

test("a pinned schedule is preserved rather than rebuilt", () => {
  const kit = createSampleKit();
  kit.schedule.state = "pinned";
  kit.schedule.days[0].focus = "My own plan";

  const reconciled = reconcileKit(kit);
  assert.equal(reconciled.schedule.days[0].focus, "My own plan");
});
