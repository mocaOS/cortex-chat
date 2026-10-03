// Full local evaluation entry: real Next HTTP routes, parser/history clients,
// controllable synthetic upstream. Exit reflects finalization and cleanup too.
import { withChatRuntime } from "./chat-journey-runtime.mjs";
import { runAskChecks } from "./chat-ask-checks";
import { runMemoryChecks } from "./chat-memory-checks";
import { runPageCallbackProbes } from "./chat-page-callback-probe";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

interface RuntimeResult {
  ok: boolean;
  errors: string[];
  checks: { id: string; ok: boolean; detail?: unknown }[];
  cleanup: { artifactsCopiedTo: string | null; status: string; scratchRemoved: boolean } | null;
  isolation: { drift: unknown[]; networkTripwire: unknown } | null;
}

async function main() {
  const [outputDir, label = "ask-memory-20261002"] = process.argv.slice(2);
  if (!outputDir || process.argv.length > 4) throw new Error("usage: node --import tsx scripts/chat-journey-checks.ts <new-output-directory> [run-id]");
  const scripts = dirname(fileURLToPath(import.meta.url));
  let findings: unknown[] = [];
  const result = await withChatRuntime(async (ctx: any) => {
    const ask = await runAskChecks(ctx);
    for (const check of ask) ctx.check(check.id, check.ok, check.detail);
    const memory = await runMemoryChecks(ctx);
    findings = memory.findings;
    for (const check of memory.checks) ctx.check(`memory.${check.id}`, check.ok, check.detail);
    writeFileSync(join(ctx.workDir, "logs", "findings.json"), JSON.stringify(findings, null, 2));
    for (const check of await runPageCallbackProbes(ctx)) ctx.check(check.id, check.ok, check.detail);
  }, { outputDir: resolve(outputDir), label, requestTimeoutMs: 60_000,
    scenarioInputs: ["chat-journey-runtime.mjs", "chat-journey-checks.ts", "chat-ask-checks.ts", "chat-memory-checks.ts", "chat-page-callback-probe.ts"].map(f => join(scripts, f)) }) as unknown as RuntimeResult;
  // Positive intended-behavior gates (authorized fix slice). Required
  // selection: each ID must appear EXACTLY once; verdicts fail closed — a
  // missing/duplicate row or a failed execution is inconclusive, never
  // passed; only a present, passing row on a passing execution passes.
  const requiredPageGates = [
    "page.healthy-settled-control",
    "page.legacy-preserved-control",
    "page.no-later-inflight-gate",
    "page.regenerate-snapshot-gate",
    "page.edit-last-snapshot-gate",
    "page.session-isolation-gate",
  ] as const;
  const gateVerdict = (id: string): string => {
    const rows = result.checks.filter(c => c.id === id);
    if (rows.length !== 1) return "inconclusive"; // missing/duplicate selection
    if (!rows[0].ok) return "failed"; // obligation itself failed; execution state is reported separately
    return result.ok ? "passed" : "inconclusive"; // passing row on a failed execution is not acceptance
  };
  const verdicts = {
    evaluationExecution: result.ok ? "passed" : "failed",
    httpAskAndPersistence: result.ok ? "passed" : "not-accepted",
    pagePositiveGatesRequired: [...requiredPageGates],
    requiredSelectionComplete: requiredPageGates.every(id => result.checks.filter(c => c.id === id).length === 1),
    pageHealthySettledControl: gateVerdict("page.healthy-settled-control"),
    pageLegacyPreservedControl: gateVerdict("page.legacy-preserved-control"),
    pageNoLaterInflight: gateVerdict("page.no-later-inflight-gate"),
    pageRegenerateSnapshot: gateVerdict("page.regenerate-snapshot-gate"),
    pageEditLastSnapshot: gateVerdict("page.edit-last-snapshot-gate"),
    pageSessionIsolationLateOrigin: gateVerdict("page.session-isolation-gate"),
    browserJourney: "not-run",
    note: "Positive intended-behavior gates for the page late-callback obligations, judged against the live candidate extraction; healthy controls are required alongside them. Verdicts fail closed: only a present, passing gate row on a passing execution is passed. Gate sensitivity is proven separately against the retained defective baseline fixture (tests/fixtures/page-late-callback-baseline.ts via tests/chat-page-callback-oracle.test.ts) — that evidence is not a product-obligation pass.",
  };
  // Persist explicit claim verdicts beside the full final result. This augments
  // evidence only: it cannot turn a runtime/finalizer failure into acceptance.
  if (result.cleanup?.artifactsCopiedTo) writeFileSync(join(result.cleanup.artifactsCopiedTo, "claim-verdicts.json"), JSON.stringify(verdicts, null, 2));
  process.stdout.write(JSON.stringify({ executionPassed: result.ok, label, verdicts, errors: result.errors,
    selected: result.checks.length, passed: result.checks.filter(c => c.ok).length,
    failedChecks: result.checks.filter(c => !c.ok), cleanup: result.cleanup,
    drift: result.isolation?.drift, tripwire: result.isolation?.networkTripwire }, null, 2) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}
main().catch(error => { process.stderr.write(String(error.stack ?? error) + "\n"); process.exitCode = 1; });
