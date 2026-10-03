// Reusable browser-journey runner over the shared chat-journey runtime
// (read-only). Owns nothing but this file and scripts/chat-browser-checks.ts.
//
// Baseline mode (default requirement of the accepted plan):
//   TMPDIR=/var/tmp/cortex-qa-tmp node --import tsx scripts/chat-browser-journey.ts \
//     <new-output-directory> <run-id> --mode baseline
// Candidate mode (authorized fix slice, same frozen gates judged directly):
//   ... --mode candidate
//
// Exit code reflects evaluation EXECUTION only. Product obligations are
// reported separately in claim-verdicts.json: in baseline mode a successful
// run means the frozen positive gates rejected the retained broken page (the
// page obligations remain FAILED), never that the product passed.
import { withChatRuntime } from "./chat-journey-runtime.mjs";
import { runBrowserChecks, browserPrerequisites, type BrowserMode } from "./chat-browser-checks";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

interface RuntimeResult {
  ok: boolean;
  errors: string[];
  checks: { id: string; ok: boolean; detail?: unknown }[];
  cleanup: { artifactsCopiedTo: string | null; status: string; scratchRemoved: boolean } | null;
  isolation: { drift: unknown[]; networkTripwire: unknown } | null;
  evidence: { claimsSupported: string[]; claimsNotSupported: string[] } | null;
}

const REPRO_IDS = {
  rapid: "rapid.defect-reproduced",
  regen: "regen.defect-reproduced",
  editlast: "editlast.defect-reproduced",
  switch: "switch.defect-reproduced",
};

const CASE_GATES: Record<string, string[]> = {
  "control.settled-turn-late-memory": ["settled.late-memory-durable", "settled.reload-visible", "settled.next-send-replay", "settled.pre-release-state-clean"],
  "control.legacy-order": ["legacy.memory-before-done-durable", "legacy.reload-visible", "legacy.next-send-replay"],
  [REPRO_IDS.rapid]: ["rapid.no-inflight-turn-persisted", "rapid.late-memory-persisted", "rapid.turn2-still-settles", "rapid.turn2-request-memory-replay-clean"],
  [REPRO_IDS.regen]: ["regen.turn1-memory-durable", "regen.snapshot-replay-request", "regen.snapshot-memory-durable", "regen.no-inflight-turn-persisted", "regen.redo-still-settles"],
  [REPRO_IDS.editlast]: ["editlast.snapshot-replay-request", "editlast.snapshot-memory-durable", "editlast.no-inflight-turn-persisted", "editlast.redo-still-settles"],
  [REPRO_IDS.switch]: ["switch.callback-session-bound", "switch.origin-late-memory-not-lost", "switch.origin-chat-history-intact", "switch.other-chat-untouched"],
};
const requiredChecks = (mode: BrowserMode) => [
  "browser.login.form-real", "browser.surface.dark-en", "browser.surface.dark-de",
  "browser.upstream.no-unmatched-asks", "browser.upstream.all-released",
  "browser.no-page-errors", "browser.isolation.no-blocked-browser-requests", "browser.no-unhandled-rejections",
  ...Object.entries(CASE_GATES).flatMap(([id, gates]) => mode === "baseline" ? [id] : gates.map(g => `${id}.gate.gate.${g}`)),
];

function parseArgs(argv: string[]) {
  let outputDir: string | null = null;
  let runId: string | null = null;
  let mode: BrowserMode = "baseline";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode" || arg.startsWith("--mode=")) {
      const value = arg.startsWith("--mode=") ? arg.slice("--mode=".length) : argv[++i];
      if (value !== "baseline" && value !== "candidate") {
        throw new Error(`--mode must be "baseline" or "candidate", got: ${value}`);
      }
      mode = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (outputDir === null) {
      outputDir = arg;
    } else if (runId === null) {
      runId = arg;
    } else {
      throw new Error("unexpected positional argument: " + arg);
    }
  }
  if (!outputDir || !runId) {
    throw new Error(
      "usage: node --import tsx scripts/chat-browser-journey.ts <new-output-directory> <run-id> [--mode baseline|candidate]"
    );
  }
  return { outputDir: resolve(outputDir), runId, mode };
}

async function main() {
  // Keep the shared runtime's evidence finalization alive if a stray
  // browser-side promise rejects; the rejection is reported, not swallowed.
  const unhandled: string[] = [];
  process.on("unhandledRejection", (reason) => {
    unhandled.push(String(reason));
    process.exitCode = 1;
    process.stderr.write(`[chat-browser-journey] unhandledRejection: ${String(reason)}\n`);
  });
  const { outputDir, runId, mode } = parseArgs(process.argv.slice(2));

  // Fail fast on browser tooling BEFORE any scratch is created: the actual
  // installed Playwright and cached Chromium must already exist (no installs,
  // no dependency changes).
  const prereq = browserPrerequisites();
  if (prereq.problems.length > 0) {
    process.stderr.write(
      "browser tooling prerequisite missing (no installs permitted):\n  " +
        prereq.problems.join("\n  ") +
        "\nSet CHAT_BROWSER_PLAYWRIGHT_CORE / CHAT_BROWSER_CHROMIUM to an existing installation.\n"
    );
    process.exitCode = 1;
    return;
  }

  const scripts = dirname(fileURLToPath(import.meta.url));
  const result = (await withChatRuntime(async (ctx: any) => {
    await runBrowserChecks(ctx, mode);
    ctx.check("browser.no-unhandled-rejections", unhandled.length === 0, { errors: unhandled });
    const required = requiredChecks(mode);
    ctx.check("browser.required-selection-complete", required.every(id =>
      ctx.checks.filter((c: { id: string }) => c.id === id).length === 1), { required });
  }, {
    outputDir,
    label: runId,
    requestTimeoutMs: 60_000,
    scenarioInputs: [
      "chat-journey-runtime.mjs",
      "chat-browser-journey.ts",
      "chat-browser-checks.ts",
    ].map((f) => join(scripts, f)),
  })) as unknown as RuntimeResult;

  if (unhandled.length) {
    result.ok = false;
    result.errors.push(...unhandled.map(error => `unhandled rejection: ${error}`));
  }
  if (result.evidence) {
    result.evidence.claimsSupported.push("actual Chromium Chat UI journeys: held late-memory races, settled/legacy controls, reload/replay and dark EN/DE surfaces (see claim verdicts)");
    result.evidence.claimsNotSupported = result.evidence.claimsNotSupported.filter(c => c !== "browser journeys");
    result.evidence.claimsNotSupported.push("untested browser journeys, production parity, other browsers and external-service quality");
  }

  const repro = (id: string) => result.checks.find((c) => c.id === id);
  const verdicts: Record<string, unknown> = mode === "baseline"
    ? {
        mode,
        evaluationExecution: result.ok ? "passed" : "failed",
        productObligations: {
          pageRapidNextSendLateMemory: repro(REPRO_IDS.rapid)?.ok === true ? "failed" : "inconclusive",
          pageRegenerateSnapshot: repro(REPRO_IDS.regen)?.ok === true ? "failed" : "inconclusive",
          pageEditLastSnapshot: repro(REPRO_IDS.editlast)?.ok === true ? "failed" : "inconclusive",
          pageChatSwitchIsolation: repro(REPRO_IDS.switch)?.ok === true ? "failed" : "inconclusive",
        },
        browserJourney: result.ok ? "executed-baseline: frozen positive gates rejected the retained broken page; product obligations remain failed" : "not-accepted",
        note: "Successful defect reproduction does not accept any page obligation. Candidate fixes are judged in --mode candidate with the same frozen gates.",
      }
    : {
        mode,
        evaluationExecution: result.ok ? "passed" : "failed",
        productObligations: {
           pageRapidNextSendLateMemory: result.ok && repro(`${REPRO_IDS.rapid}.gate.gate.rapid.no-inflight-turn-persisted`)?.ok === true ? "passed" : "not-accepted",
           pageRegenerateSnapshot: result.ok && repro(`${REPRO_IDS.regen}.gate.gate.regen.snapshot-memory-durable`)?.ok === true ? "passed" : "not-accepted",
           pageEditLastSnapshot: result.ok && repro(`${REPRO_IDS.editlast}.gate.gate.editlast.snapshot-memory-durable`)?.ok === true ? "passed" : "not-accepted",
           pageChatSwitchIsolation: result.ok && repro(`${REPRO_IDS.switch}.gate.gate.switch.callback-session-bound`)?.ok === true ? "passed" : "not-accepted",
        },
        browserJourney: result.ok ? "passed" : "not-accepted",
      };

  if (result.cleanup?.artifactsCopiedTo) {
    writeFileSync(join(result.cleanup.artifactsCopiedTo, "results.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(result.cleanup.artifactsCopiedTo, "claim-verdicts.json"), JSON.stringify(verdicts, null, 2));
  }
  process.stdout.write(
    JSON.stringify(
      {
        executionPassed: result.ok,
        mode,
        runId,
        verdicts,
        selected: result.checks.length,
        passed: result.checks.filter((c) => c.ok).length,
        failedChecks: result.checks.filter((c) => !c.ok),
        errors: result.errors,
        cleanup: result.cleanup,
        drift: result.isolation?.drift,
        tripwire: result.isolation?.networkTripwire,
      },
      null,
      2
    ) + "\n"
  );
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\n");
  process.exitCode = 1;
});
