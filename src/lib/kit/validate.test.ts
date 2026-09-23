import assert from "node:assert/strict";
import test from "node:test";
import { createSampleKit } from "./sample";
import { validateKit } from "./validate";
import type { Kit } from "./types";

function kitWith(mutate: (kit: Kit) => void): Kit {
  const kit = structuredClone(createSampleKit()) as Kit;
  mutate(kit);
  return kit;
}

function assertRejects(kit: Kit, pattern: RegExp) {
  const errors = validateKit(kit);
  assert.ok(errors.length > 0, "expected the kit to be rejected");
  assert.ok(
    errors.some((error) => pattern.test(error)),
    `expected an error matching ${pattern}, got: ${errors.join(" | ")}`,
  );
}

test("the sample kit satisfies the Appendix A structure", () => {
  assert.deepEqual(validateKit(createSampleKit()), []);
});

test("a kit missing a required top-level section is rejected", () => {
  assertRejects(kitWith((kit) => delete (kit as Partial<Kit>).company_brief), /company_brief is missing/);
  assertRejects(kitWith((kit) => delete (kit as Partial<Kit>).coverage), /coverage is missing/);
});

test("enum fields are checked", () => {
  assertRejects(
    kitWith((kit) => {
      kit.role.requirements[0].priority = "maybe" as never;
    }),
    /priority must be one of/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.role.requirements[0].kind = "vibes" as never;
    }),
    /kind must be one of/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.questions[0].category = "trivia" as never;
    }),
    /category must be one of/,
  );
});

test("difficulty must be an integer from 1 to 3", () => {
  assertRejects(
    kitWith((kit) => {
      kit.questions[0].difficulty = 2.5 as never;
    }),
    /difficulty must be an integer/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.questions[0].difficulty = 4 as never;
    }),
    /difficulty must be an integer/,
  );
});

test("durations must be integer minutes", () => {
  assertRejects(
    kitWith((kit) => {
      kit.schedule.days[0].minutes = 42.5;
    }),
    /minutes must be a positive integer/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.schedule.days[0].minutes = 0;
    }),
    /minutes must be a positive integer/,
  );
});

test("ids must be unique within a kit", () => {
  assertRejects(
    kitWith((kit) => {
      kit.questions[1].id = kit.questions[0].id;
    }),
    /is duplicated/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.role.requirements[1].id = kit.role.requirements[0].id;
    }),
    /is duplicated/,
  );
});

test("every reference must resolve", () => {
  assertRejects(
    kitWith((kit) => {
      kit.questions[0].requirement_ids = ["r-nope"];
    }),
    /references unknown requirement/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.schedule.days[0].question_ids = ["q-nope"];
    }),
    /schedules unknown question/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.flashcards[0].requirement_ids = ["r-nope"];
    }),
    /references unknown requirement/,
  );
});

test("the schedule must span exactly days_available", () => {
  assertRejects(
    kitWith((kit) => {
      kit.schedule.days.pop();
    }),
    /days_available/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.schedule.days_available = 61;
    }),
    /days_available must be an integer from 1 to 60/,
  );
});

test("day numbers must be sequential from 1", () => {
  assertRejects(
    kitWith((kit) => {
      kit.schedule.days[1].day = 7;
    }),
    /day must be 2/,
  );
});

test("a kit shipping an uncovered must-have is rejected", () => {
  assertRejects(
    kitWith((kit) => {
      // Remove the only question covering r1, a must-have.
      kit.questions = kit.questions.filter((question) => !question.requirement_ids.includes("r1"));
      kit.schedule.days = kit.schedule.days.map((day) => ({
        ...day,
        question_ids: day.question_ids.filter((id) => kit.questions.some((question) => question.id === id)),
      }));
    }),
    /Must-have requirements have no question/,
  );
});

test("a must-have whose question is never scheduled is rejected", () => {
  assertRejects(
    kitWith((kit) => {
      kit.schedule.days = kit.schedule.days.map((day) => ({
        ...day,
        question_ids: day.question_ids.filter((id) => id !== "q1"),
      }));
    }),
    /never appear in the schedule/,
  );
});

test("coverage may only reference known requirements", () => {
  assertRejects(
    kitWith((kit) => {
      kit.coverage.uncovered_requirement_ids = ["r-nope"];
    }),
    /coverage references unknown requirement/,
  );
  assertRejects(
    kitWith((kit) => {
      kit.coverage.passes = 0;
    }),
    /passes must be an integer of at least 1/,
  );
});

test("timestamps must parse", () => {
  assertRejects(
    kitWith((kit) => {
      kit.source.researched_at = "last Tuesday";
    }),
    /researched_at must be an ISO timestamp/,
  );
});
