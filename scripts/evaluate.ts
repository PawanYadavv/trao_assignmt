import { readFile, writeFile } from "node:fs/promises";
import { generateKit } from "../src/lib/pipeline/generate";
import { researchCompany } from "../src/lib/pipeline/retrieve";

interface CaseInput { id: string; jd: string; company_url: string; days: number }

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = argument("--input");
const outputPath = argument("--output");
if (!inputPath || !outputPath) throw new Error("Usage: npm run evaluate -- --input cases.json --output kits.json");
const inputFile = inputPath;
const outputFile = outputPath;

async function main() {
  const parsed = JSON.parse(await readFile(inputFile, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Input must be an array of cases.");
  const cases = parsed as unknown[];
  const kits = [];
  for (const raw of cases) {
    const item = raw as Partial<CaseInput>;
    if (typeof item.id !== "string" || typeof item.jd !== "string" || typeof item.company_url !== "string" || typeof item.days !== "number") {
      kits.push({ id: typeof item.id === "string" ? item.id : "unknown", status: "failed", kit: null, error: { code: "INVALID_CASE", message: "Case must include id, jd, company_url, and numeric days." } });
      continue;
    }
    try {
      const research = await researchCompany(item.company_url);
      const kit = await generateKit({ jd: item.jd, company_url: item.company_url, days: item.days }, research);
      kits.push({ id: item.id, status: "ok", kit, error: null });
    } catch (error) {
      kits.push({ id: item.id, status: "failed", kit: null, error: { code: "COMPANY_UNREACHABLE", message: error instanceof Error ? error.message : "Case failed." } });
    }
  }
  await writeFile(outputFile, JSON.stringify({ version: "1.0", generated_at: new Date().toISOString(), kits }, null, 2));
}

void main();
