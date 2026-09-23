/**
 * Structural validation against Appendix A.
 *
 * A kit is validated before it is persisted or written to the batch output, so
 * a malformed model response can never reach storage. The checks are exhaustive
 * rather than sampling: field presence, enum membership, integer-ness of every
 * duration, referential integrity of every id, and the two guarantees the brief
 * calls out - every must-have requirement has a question, and the schedule
 * spans exactly the days requested.
 */

import { buildCoverageReport } from "./coverage";
import { MAX_DAYS, MIN_DAYS } from "./schedule";
import type { Kit, QuestionCategory, RequirementKind, RequirementPriority } from "./types";

const KINDS: RequirementKind[] = ["technical", "behavioural", "domain"];
const PRIORITIES: RequirementPriority[] = ["must", "nice"];
const CATEGORIES: QuestionCategory[] = ["technical", "behavioural", "system-design", "company-fit"];

const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export function validateKit(kit: Kit): string[] {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);

  if (!kit || typeof kit !== "object") return ["Kit is not an object."];

  // --- source ---------------------------------------------------------------
  const source = kit.source;
  if (!source || typeof source !== "object") {
    fail("source is missing.");
  } else {
    if (!isString(source.company)) fail("source.company must be a string.");
    if (!isString(source.company_url)) fail("source.company_url must be a string.");
    if (!isString(source.role)) fail("source.role must be a string.");
    if (!isString(source.location)) fail("source.location must be a string.");
    if (!isInteger(source.jd_chars) || source.jd_chars < 0) fail("source.jd_chars must be a non-negative integer.");
    if (!isString(source.researched_at) || Number.isNaN(Date.parse(source.researched_at))) {
      fail("source.researched_at must be an ISO timestamp.");
    }
    if (!isStringArray(source.pages_used)) fail("source.pages_used must be an array of strings.");
  }

  // --- company_brief --------------------------------------------------------
  const brief = kit.company_brief;
  if (!brief || typeof brief !== "object") {
    fail("company_brief is missing.");
  } else {
    if (!isNonEmptyString(brief.summary)) fail("company_brief.summary must be a non-empty string.");
    if (!isNonEmptyString(brief.what_they_do)) fail("company_brief.what_they_do must be a non-empty string.");
    if (!isStringArray(brief.sources)) fail("company_brief.sources must be an array of strings.");
  }

  // --- role and requirements ------------------------------------------------
  const requirementIds = new Set<string>();
  const role = kit.role;
  if (!role || typeof role !== "object") {
    fail("role is missing.");
  } else {
    if (!isString(role.title)) fail("role.title must be a string.");
    if (!isString(role.seniority)) fail("role.seniority must be a string.");
    if (!isStringArray(role.responsibilities)) fail("role.responsibilities must be an array of strings.");

    if (!Array.isArray(role.requirements)) {
      fail("role.requirements must be an array.");
    } else {
      role.requirements.forEach((requirement, index) => {
        const at = `role.requirements[${index}]`;
        if (!requirement || typeof requirement !== "object") return fail(`${at} must be an object.`);
        if (!isNonEmptyString(requirement.id)) fail(`${at}.id must be a non-empty string.`);
        else if (requirementIds.has(requirement.id)) fail(`${at}.id "${requirement.id}" is duplicated.`);
        else requirementIds.add(requirement.id);
        if (!isNonEmptyString(requirement.text)) fail(`${at}.text must be a non-empty string.`);
        if (!KINDS.includes(requirement.kind)) fail(`${at}.kind must be one of ${KINDS.join(", ")}.`);
        if (!PRIORITIES.includes(requirement.priority)) fail(`${at}.priority must be one of ${PRIORITIES.join(", ")}.`);
      });
    }
  }

  // --- questions ------------------------------------------------------------
  const questionIds = new Set<string>();
  if (!Array.isArray(kit.questions)) {
    fail("questions must be an array.");
  } else {
    kit.questions.forEach((question, index) => {
      const at = `questions[${index}]`;
      if (!question || typeof question !== "object") return fail(`${at} must be an object.`);
      if (!isNonEmptyString(question.id)) fail(`${at}.id must be a non-empty string.`);
      else if (questionIds.has(question.id)) fail(`${at}.id "${question.id}" is duplicated.`);
      else questionIds.add(question.id);
      if (!isStringArray(question.requirement_ids)) fail(`${at}.requirement_ids must be an array of strings.`);
      else {
        for (const id of question.requirement_ids) {
          if (!requirementIds.has(id)) fail(`${at} references unknown requirement "${id}".`);
        }
      }
      if (!CATEGORIES.includes(question.category)) fail(`${at}.category must be one of ${CATEGORIES.join(", ")}.`);
      if (!isNonEmptyString(question.prompt)) fail(`${at}.prompt must be a non-empty string.`);
      if (!isNonEmptyString(question.answer_outline)) fail(`${at}.answer_outline must be a non-empty string.`);
      if (!isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 3) {
        fail(`${at}.difficulty must be an integer from 1 to 3.`);
      }
    });
  }

  // --- flashcards -----------------------------------------------------------
  const flashcardIds = new Set<string>();
  if (!Array.isArray(kit.flashcards)) {
    fail("flashcards must be an array.");
  } else {
    kit.flashcards.forEach((card, index) => {
      const at = `flashcards[${index}]`;
      if (!card || typeof card !== "object") return fail(`${at} must be an object.`);
      if (!isNonEmptyString(card.id)) fail(`${at}.id must be a non-empty string.`);
      else if (flashcardIds.has(card.id)) fail(`${at}.id "${card.id}" is duplicated.`);
      else flashcardIds.add(card.id);
      if (!isNonEmptyString(card.front)) fail(`${at}.front must be a non-empty string.`);
      if (!isNonEmptyString(card.back)) fail(`${at}.back must be a non-empty string.`);
      if (!isStringArray(card.requirement_ids)) fail(`${at}.requirement_ids must be an array of strings.`);
      else {
        for (const id of card.requirement_ids) {
          if (!requirementIds.has(id)) fail(`${at} references unknown requirement "${id}".`);
        }
      }
    });
  }

  // --- schedule -------------------------------------------------------------
  const schedule = kit.schedule;
  if (!schedule || typeof schedule !== "object") {
    fail("schedule is missing.");
  } else {
    if (!isInteger(schedule.days_available) || schedule.days_available < MIN_DAYS || schedule.days_available > MAX_DAYS) {
      fail(`schedule.days_available must be an integer from ${MIN_DAYS} to ${MAX_DAYS}.`);
    }
    if (!Array.isArray(schedule.days)) {
      fail("schedule.days must be an array.");
    } else {
      if (schedule.days.length !== schedule.days_available) {
        fail(`schedule.days has ${schedule.days.length} entries but days_available is ${schedule.days_available}.`);
      }
      schedule.days.forEach((day, index) => {
        const at = `schedule.days[${index}]`;
        if (!day || typeof day !== "object") return fail(`${at} must be an object.`);
        if (day.day !== index + 1) fail(`${at}.day must be ${index + 1}.`);
        if (!isNonEmptyString(day.focus)) fail(`${at}.focus must be a non-empty string.`);
        if (!isInteger(day.minutes) || day.minutes <= 0) fail(`${at}.minutes must be a positive integer.`);
        if (!isStringArray(day.question_ids)) fail(`${at}.question_ids must be an array of strings.`);
        else {
          for (const id of day.question_ids) {
            if (!questionIds.has(id)) fail(`${at} schedules unknown question "${id}".`);
          }
        }
      });
    }
  }

  // --- coverage -------------------------------------------------------------
  const coverage = kit.coverage;
  if (!coverage || typeof coverage !== "object") {
    fail("coverage is missing.");
  } else {
    if (!isStringArray(coverage.uncovered_requirement_ids)) {
      fail("coverage.uncovered_requirement_ids must be an array of strings.");
    } else {
      for (const id of coverage.uncovered_requirement_ids) {
        if (!requirementIds.has(id)) fail(`coverage references unknown requirement "${id}".`);
      }
    }
    if (!isInteger(coverage.passes) || coverage.passes < 1) fail("coverage.passes must be an integer of at least 1.");
  }

  // --- cross-cutting guarantees --------------------------------------------
  if (Array.isArray(role?.requirements) && Array.isArray(kit.questions)) {
    const report = buildCoverageReport(role.requirements, kit.questions);
    if (report.uncoveredMustIds.length) {
      fail(`Must-have requirements have no question: ${report.uncoveredMustIds.join(", ")}.`);
    }
    if (Array.isArray(schedule?.days)) {
      const scheduled = new Set(schedule.days.flatMap((day) => day.question_ids ?? []));
      const unscheduledMusts = role.requirements
        .filter((requirement) => requirement.priority === "must")
        .filter((requirement) =>
          !kit.questions.some(
            (question) => question.requirement_ids.includes(requirement.id) && scheduled.has(question.id),
          ),
        )
        .map((requirement) => requirement.id);
      if (unscheduledMusts.length) {
        fail(`Must-have requirements never appear in the schedule: ${unscheduledMusts.join(", ")}.`);
      }
    }
  }

  return errors;
}

export function assertValidKit(kit: Kit): Kit {
  const errors = validateKit(kit);
  if (errors.length) {
    throw new Error(`Generated kit failed structure validation: ${errors.slice(0, 5).join(" ")}`);
  }
  return kit;
}
