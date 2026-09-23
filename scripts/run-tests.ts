/**
 * Test runner.
 *
 * Node 20's test runner only discovers `.js` test files when given a directory,
 * and shell globs are not portable across cmd.exe and sh. So we find the
 * TypeScript test files ourselves and hand them to `tsx --test` explicitly.
 */

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "src");

async function findTests(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return findTests(full);
      return entry.name.endsWith(".test.ts") ? [full] : [];
    }),
  );
  return found.flat();
}

async function main() {
  const files = (await findTests(ROOT)).sort();

  if (!files.length) {
    console.error("No test files found.");
    process.exit(1);
  }

  const child = spawn("node", ["--import", "tsx", "--test", ...files], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  child.on("exit", (code) => process.exit(code ?? 1));
}

void main();
