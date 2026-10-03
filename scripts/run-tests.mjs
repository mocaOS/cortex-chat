#!/usr/bin/env node
// Cross-platform test entry point. Builds the explicit test-file list with
// fs.readdirSync (no dependence on shell glob expansion) and invokes the
// current Node binary with the same loader flags `npm test` used before.
// Intentionally dependency-free: process.execPath + child_process only.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir = join(repoRoot, "tests");

const testFiles = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join(testsDir, f));

if (testFiles.length === 0) {
  console.error(`no *.test.ts files found in ${testsDir}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--conditions=react-server", "--test", ...testFiles],
  { stdio: "inherit", cwd: repoRoot }
);

process.exit(result.status ?? 1);
