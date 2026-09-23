#!/usr/bin/env node
/**
 * Batch entry point (Section 9).
 *
 *   npm run evaluate -- --input cases.json --output kits.json
 *
 * Runs the same `runPipeline` the HTTP API uses - there is no parallel
 * implementation here, only file I/O, concurrency and error shaping.
 *
 * A case is only `failed` when no kit could be produced at all. A company we
 * could not reach is not a failure: the description alone still yields a kit,
 * with the gap recorded honestly in `kit.warnings`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { runPipeline } from "../src/lib/pipeline/generate";
import { RetrievalError } from "../src/lib/pipeline/retrieve";
import type { Kit } from "../src/lib/kit/types";

interface CaseInput {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

interface CaseOutput {
  id: string;
  status: "ok" | "failed";
  kit: Kit | null;
  error: { code: string; message: string } | null;
}

/** Cases run concurrently, but gently: the LLM client has its own rate gate. */
const DEFAULT_CONCURRENCY = 2;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function usage(): never {
  console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2]");
  process.exit(1);
}

function errorCodeFor(error: unknown): string {
  if (error instanceof RetrievalError) return error.code;
  const message = error instanceof Error ? error.message : "";
  if (/structure validation/i.test(message)) return "INVALID_KIT";
  if (/timed out|timeout|aborted/i.test(message)) return "TIMEOUT";
  return "GENERATION_FAILED";
}

function validateCase(raw: unknown): { value: CaseInput } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Case must be an object." };
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) return { error: "Case is missing a string id." };
  if (typeof record.jd !== "string") return { error: "Case is missing a string jd." };
  if (typeof record.company_url !== "string") return { error: "Case is missing a string company_url." };
  const days = typeof record.days === "number" ? record.days : Number(record.days);
  if (!Number.isFinite(days)) return { error: "Case is missing a numeric days value." };
  return { value: { id: record.id, jd: record.jd, company_url: record.company_url, days } };
}

async function runCase(input: CaseInput): Promise<CaseOutput> {
  const started = Date.now();
  try {
    const kit = await runPipeline({ jd: input.jd, company_url: input.company_url, days: input.days });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const uncovered = kit.coverage.uncovered_requirement_ids.length;
    console.log(
      `  ok      ${input.id}  ${kit.role.requirements.length} requirements, ${kit.questions.length} questions, ` +
        `${kit.schedule.days.length} days, ${kit.coverage.passes} pass(es), ${uncovered} uncovered  [${seconds}s]`,
    );
    return { id: input.id, status: "ok", kit, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Case failed.";
    console.error(`  failed  ${input.id}  ${message}`);
    return { id: input.id, status: "failed", kit: null, error: { code: errorCodeFor(error), message } };
  }
}

/** Runs tasks with a fixed worker pool, preserving input order in the output. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function drain() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, drain));
  return results;
}

async function main() {
  const inputPath = argument("--input");
  const outputPath = argument("--output");
  if (!inputPath || !outputPath) usage();

  const concurrency = Math.max(1, Number(argument("--concurrency")) || DEFAULT_CONCURRENCY);

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    console.error(`Could not read ${inputPath}: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }

  if (!Array.isArray(parsed)) {
    console.error("Input must be a JSON array of cases.");
    process.exit(1);
  }

  console.log(`Running ${parsed.length} case(s) with concurrency ${concurrency}...`);
  const started = Date.now();

  const outputs = await mapWithConcurrency(parsed, concurrency, async (raw): Promise<CaseOutput> => {
    const checked = validateCase(raw);
    if ("error" in checked) {
      const id = (raw as { id?: unknown })?.id;
      const caseId = typeof id === "string" && id.trim() ? id : "unknown";
      console.error(`  failed  ${caseId}  ${checked.error}`);
      return { id: caseId, status: "failed", kit: null, error: { code: "INVALID_CASE", message: checked.error } };
    }
    return runCase(checked.value);
  });

  await writeFile(
    outputPath,
    `${JSON.stringify({ version: "1.0", generated_at: new Date().toISOString(), kits: outputs }, null, 2)}\n`,
    "utf8",
  );

  const ok = outputs.filter((entry) => entry.status === "ok").length;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${ok}/${outputs.length} case(s) produced a kit in ${seconds}s. Wrote ${outputPath}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
