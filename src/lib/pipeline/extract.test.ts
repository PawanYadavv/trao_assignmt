import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyKind,
  extractRequirementsDeterministically,
  extractRoleDetailsDeterministically,
  isGroundedIn,
} from "./extract";

const STRUCTURED = `Senior Backend Engineer

Required:
- 5+ years building production Node.js services
- Strong PostgreSQL and schema design
- Experience leading incident response

Nice to have:
- Kubernetes exposure
- Bonus points for Go`;

function byText(jd: string) {
  return new Map(extractRequirementsDeterministically(jd).map((entry) => [entry.text, entry]));
}

test("a requirements section yields one requirement per bullet", () => {
  const found = extractRequirementsDeterministically(STRUCTURED);
  assert.equal(found.length, 5);
  assert.deepEqual(
    found.map((entry) => entry.id),
    ["r1", "r2", "r3", "r4", "r5"],
  );
});

test("must and nice are taken from how the posting words it", () => {
  const found = byText(STRUCTURED);
  assert.equal(found.get("5+ years building production Node.js services")?.priority, "must");
  assert.equal(found.get("Strong PostgreSQL and schema design")?.priority, "must");
  assert.equal(found.get("Kubernetes exposure")?.priority, "nice");
  assert.equal(found.get("Go")?.priority, "nice", "a bonus line is not a requirement");
});

test("an inline Required/Preferred label overrides the surrounding prose", () => {
  const jd = `Platform Engineer

You will own our AWS footprint. Required: 4 years of infrastructure work. Preferred: Rust.`;
  const found = byText(jd);
  assert.equal(found.get("4 years of infrastructure work")?.priority, "must");
  assert.equal(found.get("Rust")?.priority, "nice");
});

test("benefits and boilerplate are not requirements", () => {
  const jd = `Engineer

Requirements:
- 3 years of Python

Benefits
- Private health insurance
- 30 days holiday

We are an equal opportunity employer.`;
  const texts = extractRequirementsDeterministically(jd).map((entry) => entry.text);
  assert.deepEqual(texts, ["3 years of Python"]);
});

test("responsibilities are separated from requirements", () => {
  const jd = `Data Engineer

What you'll do
- Own our Airflow pipelines end to end

What we need
- 6+ years of Python in production`;

  assert.deepEqual(
    extractRequirementsDeterministically(jd).map((entry) => entry.text),
    ["6+ years of Python in production"],
  );
  assert.deepEqual(extractRoleDetailsDeterministically(jd).responsibilities, ["Own our Airflow pipelines end to end"]);
});

test("a two-line stub yields a small kit rather than an invented one", () => {
  const found = extractRequirementsDeterministically("Frontend dev. Must know React.");
  assert.equal(found.length, 1);
  assert.equal(found[0].text, "Must know React");
  assert.equal(found[0].priority, "must");
});

test("prose duties are split into separate requirements", () => {
  const jd = `Product Designer

We need someone to run user research, build design systems, and collaborate with engineering daily.`;
  const texts = extractRequirementsDeterministically(jd).map((entry) => entry.text);
  assert.ok(texts.includes("run user research"));
  assert.ok(texts.includes("build design systems"));
  assert.ok(texts.some((text) => text.startsWith("collaborate with engineering")));
});

test("kind is classified from vocabulary, not coincidence", () => {
  assert.equal(classifyKind("Strong PostgreSQL and schema design"), "technical");
  assert.equal(classifyKind("Mentoring junior engineers"), "behavioural");
  assert.equal(classifyKind("Familiarity with PCI compliance"), "domain");
  assert.equal(classifyKind("5 years of React"), "technical");
});

test("the title is read from the first line without swallowing the posting", () => {
  assert.equal(extractRoleDetailsDeterministically(STRUCTURED).title, "Senior Backend Engineer");
  assert.equal(extractRoleDetailsDeterministically("Frontend dev. Must know React.").title, "Frontend dev");
});

test("seniority and location are only reported when stated", () => {
  const stated = extractRoleDetailsDeterministically("Staff Data Engineer\nLocation: Berlin (hybrid)\n\nRequirements:\n- SQL");
  assert.equal(stated.seniority, "Staff");
  assert.equal(stated.location, "Berlin (hybrid)");

  const unstated = extractRoleDetailsDeterministically("Engineer\n\nRequirements:\n- SQL");
  assert.equal(unstated.seniority, "Not specified");
  assert.equal(unstated.location, "Not specified");
});

test("grounding rejects requirements the description never mentions", () => {
  const jd = "We need a backend engineer with five years of Node.js and PostgreSQL.";
  assert.ok(isGroundedIn(jd, "five years of Node.js"));
  assert.ok(isGroundedIn(jd, "PostgreSQL"));
  assert.ok(!isGroundedIn(jd, "Kubernetes cluster administration and Helm charts"));
  assert.ok(!isGroundedIn(jd, "Salesforce integration experience"));
});

test("extraction never exceeds the requirement cap", () => {
  const jd = `Engineer\n\nRequirements:\n${Array.from({ length: 40 }, (_, index) => `- ${index} years of skill number ${index}`).join("\n")}`;
  assert.ok(extractRequirementsDeterministically(jd).length <= 14);
});

test("ids are stable and sequential", () => {
  const first = extractRequirementsDeterministically(STRUCTURED);
  const second = extractRequirementsDeterministically(STRUCTURED);
  assert.deepEqual(first, second);
});
