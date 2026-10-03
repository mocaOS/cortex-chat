import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runV2LateMemoryContract } from "./helpers/late-memory-contract";

// NEGATIVE CONTROL (playbook §9.5) plus its healthy control. Both sides run
// the SAME shared observable oracle (tests/helpers/late-memory-contract.ts);
// the only variable is the implementation behind the askQuestionStream entry
// boundary.

test("healthy control: the real implementation passes the shared late-memory oracle", async () => {
  const { askQuestionStream } = await import("@/lib/api");
  await runV2LateMemoryContract(askQuestionStream);
});

test("negative control: the isolated return-at-done mutant is rejected by the oracle's own assertion — not by an import error", async () => {
  // Import OUTSIDE assert.rejects so a module-resolution failure can never be
  // mistaken for the gate rejecting the mutant's behavior.
  const mutantModule = await import("./fixtures/api-return-at-done");
  await assert.rejects(
    () => runV2LateMemoryContract(mutantModule.askQuestionStream),
    (err: unknown) =>
      err instanceof assert.AssertionError &&
      /memory_update/.test(String(err.message)),
    "the oracle must reject the mutant for the late-memory obligation itself"
  );
});

test("fixture maintenance scope: the retained mutant is the real parser with exactly one behavioral mutation", () => {
  const real = readFileSync(resolve(process.cwd(), "src/lib/api.ts"), "utf8");
  const mutant = readFileSync(
    resolve(process.cwd(), "tests/fixtures/api-return-at-done.ts"),
    "utf8"
  );
  // The fixture must remain the intentional mutant, not a drifted copy.
  assert.match(mutant, /MUTANT \(negative control\)/);

  // Normalize: strip full-line comments (the mutant's marker comment and the
  // real code's incident comments) and the added `return;`, then require
  // byte-equality with the real source. Any other divergence — e.g. the real
  // parser evolving without re-syncing the fixture — fails this structural
  // guard and the fixture must be re-synced before the behavioral control is
  // trusted again.
  const stripComments = (s: string) =>
    s
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
  const normalize = (s: string) => stripComments(s).replace(/\n\s*return;\n/g, "\n");
  assert.equal(
    normalize(mutant),
    normalize(real),
    "fixture drifted from src/lib/api.ts — re-sync tests/fixtures/api-return-at-done.ts (single behavioral mutation: stop reading at done)"
  );
});
