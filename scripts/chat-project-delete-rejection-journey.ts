import { withChatRuntime } from "./chat-journey-runtime.mjs";
import { REJECTION_GATES, runRejectionBrowser } from "./chat-project-delete-rejection-checks";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
async function main() {
  const [output, label] = process.argv.slice(2);
  if (!output || !label || process.argv.length !== 4) throw new Error("usage: node --import tsx scripts/chat-project-delete-rejection-journey.ts <fresh-output> <fresh-id>");
  const unhandled: string[] = []; process.on("unhandledRejection", e => { unhandled.push(String(e)); process.exitCode = 1; });
  const scripts = dirname(fileURLToPath(import.meta.url)), inputs = ["chat-project-delete-rejection-journey.ts", "chat-project-delete-rejection-checks.ts", "chat-project-delete-checks.ts", "chat-project-followup-checks.ts", "chat-browser-checks.ts", "chat-feed-transport.ts", "chat-journey-runtime.mjs", "tsconfig.chat-project-delete-rejection.json"];
  const required = [...REJECTION_GATES, "runtime.no-unhandled-rejections"];
  const result: any = await withChatRuntime(async (ctx: any) => {
    mkdirSync(join(ctx.workDir, "logs", "gate-snapshot"), { recursive: true }); for (const file of inputs) copyFileSync(join(scripts, file), join(ctx.workDir, "logs", "gate-snapshot", file));
    try { await runRejectionBrowser(ctx); }
    finally { ctx.check("runtime.no-unhandled-rejections", !unhandled.length, unhandled); ctx.check("runtime.required-selection", required.every(id => ctx.checks.filter((c: any) => c.id === id).length === 1), { required }); }
  }, { outputDir: resolve(output), label, requestTimeoutMs: 60000, scenarioInputs: inputs.map(f => join(scripts, f)) });
  if (unhandled.length) { result.ok = false; result.errors.push(...unhandled); }
  const verdicts = { gateVersion: "project-delete-rejection-v1", evaluationExecution: result.ok ? "passed" : "failed", browserJourney: result.ok ? "passed" : "not-accepted",
    httpJourney: "not-run: pre-dispatch fault is specific to Chromium; client rejection unit and separate delete HTTP gate apply",
    obligations: Object.fromEntries(required.map(id => [id, result.checks.find((c: any) => c.id === id)?.ok === false ? "failed" : result.ok ? "passed" : "not-accepted"])) };
  if (result.evidence) { result.evidence.claimsSupported.push("actual Chromium pre-dispatch DELETE failure/direct immutable consumers and native cancel/success (see verdicts)"); result.evidence.claimsNotSupported = result.evidence.claimsNotSupported.filter((s: string) => s !== "browser journeys"); }
  if (!result.cleanup?.artifactsCopiedTo) throw new Error("receipt not retained");
  writeFileSync(join(result.cleanup.artifactsCopiedTo, "results.json"), JSON.stringify(result, null, 2)); writeFileSync(join(result.cleanup.artifactsCopiedTo, "claim-verdicts.json"), JSON.stringify(verdicts, null, 2));
  process.stdout.write(JSON.stringify({ ok: result.ok, verdicts, selected: result.checks.length, passed: result.checks.filter((c: any) => c.ok).length, failures: result.checks.filter((c: any) => !c.ok), errors: result.errors, cleanup: result.cleanup }, null, 2) + "\n"); process.exitCode = result.ok ? 0 : 1;
}
main().catch(e => { process.stderr.write(String(e.stack ?? e) + "\n"); process.exitCode = 1; });
