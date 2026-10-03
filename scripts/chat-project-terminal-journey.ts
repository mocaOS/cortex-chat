import { withChatRuntime } from "./chat-journey-runtime.mjs";
import { TERMINAL_BROWSER_GATES, TERMINAL_HTTP_GATES, runTerminalBrowser, runTerminalHttp } from "./chat-project-terminal-checks";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
async function main() {
  const [output, label, surface] = process.argv.slice(2);
  if (!output || !label || !["http", "browser"].includes(surface) || process.argv.length !== 5) throw new Error("usage: node --import tsx scripts/chat-project-terminal-journey.ts <fresh-output> <fresh-id> http|browser");
  const unhandled: string[] = []; process.on("unhandledRejection", e => { unhandled.push(String(e)); process.exitCode = 1; });
  const scripts = dirname(fileURLToPath(import.meta.url)), inputs = ["chat-project-terminal-journey.ts", "chat-project-terminal-checks.ts", "chat-project-followup-checks.ts", "chat-browser-checks.ts", "chat-feed-transport.ts", "chat-journey-runtime.mjs", "tsconfig.chat-project-terminal.json"];
  const required = [...(surface === "http" ? TERMINAL_HTTP_GATES : TERMINAL_BROWSER_GATES), "runtime.no-unhandled-rejections"];
  const result: any = await withChatRuntime(async (ctx: any) => {
    mkdirSync(join(ctx.workDir, "logs", "gate-snapshot"), { recursive: true });
    for (const file of inputs) copyFileSync(join(scripts, file), join(ctx.workDir, "logs", "gate-snapshot", file));
    try { await (surface === "http" ? runTerminalHttp(ctx) : runTerminalBrowser(ctx)); }
    finally { ctx.check("runtime.no-unhandled-rejections", !unhandled.length, unhandled);
      ctx.check("runtime.required-selection", required.every(id => ctx.checks.filter((c: any) => c.id === id).length === 1), { required }); }
  }, { outputDir: resolve(output), label, requestTimeoutMs: 60000, scenarioInputs: inputs.map(f => join(scripts, f)) });
  if (unhandled.length) { result.ok = false; result.errors.push(...unhandled); }
  const verdicts = { gateVersion: "project-terminal-v1.4", surface, evaluationExecution: result.ok ? "passed" : "failed",
    httpJourney: surface === "http" ? (result.ok ? "passed" : "not-accepted") : "not-run-separate-http-gate",
    browserJourney: surface === "browser" ? (result.ok ? "passed" : "not-accepted") : "not-run",
    obligations: Object.fromEntries(required.map(id => [id, result.checks.find((c: any) => c.id === id)?.ok === false ? "failed" : result.ok ? "passed" : "not-accepted"])) };
  if (surface === "browser" && result.evidence) {
    result.evidence.claimsSupported.push("actual Chromium terminal edit/different exchange/fresh-page fallback gates (see verdicts)");
    result.evidence.claimsNotSupported = result.evidence.claimsNotSupported.filter((s: string) => s !== "browser journeys");
  }
  if (!result.cleanup?.artifactsCopiedTo) throw new Error("receipt not retained");
  writeFileSync(join(result.cleanup.artifactsCopiedTo, "results.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(result.cleanup.artifactsCopiedTo, "claim-verdicts.json"), JSON.stringify(verdicts, null, 2));
  process.stdout.write(JSON.stringify({ ok: result.ok, verdicts, selected: result.checks.length, passed: result.checks.filter((c: any) => c.ok).length,
    failures: result.checks.filter((c: any) => !c.ok), errors: result.errors, cleanup: result.cleanup }, null, 2) + "\n"); process.exitCode = result.ok ? 0 : 1;
}
main().catch(e => { process.stderr.write(String(e.stack ?? e) + "\n"); process.exitCode = 1; });
