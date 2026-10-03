import { withChatRuntime } from "./chat-journey-runtime.mjs";
import { browserPrerequisites } from "./chat-browser-checks";
import { BROWSER_GATES, HTTP_GATES, runProjectBrowser, runProjectHttp } from "./chat-project-checks";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

async function main() {
  const [output, label, surface] = process.argv.slice(2);
  if (!output || !label || !["http", "browser"].includes(surface) || process.argv.length !== 5)
    throw new Error("usage: node --import tsx scripts/chat-project-journey.ts <fresh-output> <fresh-id> http|browser");
  if (surface === "browser" && browserPrerequisites().problems.length)
    throw new Error(`missing browser prerequisites: ${browserPrerequisites().problems.join("; ")}`);
  const unhandled: string[] = [];
  process.on("unhandledRejection", reason => { unhandled.push(String(reason)); process.exitCode = 1; });
  const scripts = dirname(fileURLToPath(import.meta.url));
  const required = [...(surface === "http" ? HTTP_GATES : BROWSER_GATES), "runtime.no-unhandled-rejections"];
  const result: any = await withChatRuntime(async (ctx: any) => {
    try { await (surface === "http" ? runProjectHttp(ctx) : runProjectBrowser(ctx)); }
    finally {
      ctx.check("runtime.no-unhandled-rejections", unhandled.length === 0, unhandled);
      ctx.check("runtime.required-selection", required.every(id => ctx.checks.filter((c: any) => c.id === id).length === 1), { required });
    }
  }, { outputDir: resolve(output), label, requestTimeoutMs: 60000,
    scenarioInputs: ["chat-project-journey.ts", "chat-project-checks.ts", "chat-browser-checks.ts", "chat-journey-runtime.mjs"]
      .map(f => join(scripts, f)) });
  if (unhandled.length) { result.ok = false; result.errors.push(...unhandled); }
  const verdicts = { gateVersion: "project-lifecycle-v1.1", surface,
    evaluationExecution: result.ok ? "passed" : "failed",
    httpJourney: surface === "http" ? (result.ok ? "passed" : "not-accepted") : "not-run-separate-http-gate",
    browserJourney: surface === "browser" ? (result.ok ? "passed" : "not-accepted") : "not-run",
    obligations: Object.fromEntries(required.map(id => [id,
      result.checks.find((c: any) => c.id === id)?.ok === false ? "failed" :
      result.ok && result.checks.find((c: any) => c.id === id)?.ok === true ? "passed" : "not-accepted"])),
  };
  if (surface === "browser" && result.evidence) {
    result.evidence.claimsSupported.push("actual Chromium shared project adoption/rebase/overlap/navigation (see verdicts)");
    result.evidence.claimsNotSupported = result.evidence.claimsNotSupported.filter((s: string) => s !== "browser journeys");
    result.evidence.claimsNotSupported.push("other browser journeys, production Node20/Alpine and model quality");
  }
  if (!result.cleanup?.artifactsCopiedTo) throw new Error("required receipt not retained");
  writeFileSync(join(result.cleanup.artifactsCopiedTo, "results.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(result.cleanup.artifactsCopiedTo, "claim-verdicts.json"), JSON.stringify(verdicts, null, 2));
  process.stdout.write(JSON.stringify({ ok: result.ok, verdicts, checks: result.checks.length,
    passed: result.checks.filter((c: any) => c.ok).length, failures: result.checks.filter((c: any) => !c.ok),
    errors: result.errors, cleanup: result.cleanup }, null, 2) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}
main().catch(e => { process.stderr.write(String(e.stack ?? e) + "\n"); process.exitCode = 1; });
