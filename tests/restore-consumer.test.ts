// Tests for scripts/restore-consumer.mjs — the PRE-BOOT refusal gates only.
//
// The full consumer journey (production build + real Next server + HTTP
// journey against a restored fixture copy) is far too heavy for the
// deterministic contract suite; it is exercised and recorded by the main
// qa/restore orchestrator (see
// docs/regeneration/records/2026-10-01-restore-consumer.md). What belongs in
// the suite is the contract that the CLI REFUSES inputs that must never be
// silently consumed, before any copy or boot:
//
// 1. gate-only accepts a freshly seeded fixture (sentinel + synthetic IDs +
//    quiesced + real verifier) and leaves the source untouched.
// 2. missing sentinel / missing database → refusal JSON, exit 1, no work dir.
// 3. forged sentinel (wrong key fingerprint) → refusal.
// 4. missing synthetic ID (deleted fixture chat message) → refusal.
// 5. non-quiesced source (WAL sidecar present) → refusal, before the app
//    verifier could bless it.
// 6. canary-carrying (mutated) source → refused by the real verifier.
// 7. bad usage → exit 2.
// 8. --backend-url validation: remote/non-loopback targets rejected outright
//    (no live ambiguity, no fallback, no .env read); loopback requires
//    --document-file; the document snapshot must be nonempty and carry the
//    stable sid fx-source-0001.
// 9. --app-node validation (absolute/existing; gate-only = path only).
// 10. Unit controls for the pure citation-content helpers (fixture pack v2):
//     the required gate is now GET /api/proxy/api/documents/{document_id}/content
//     (id proxy-isolated-backend-citation-content-exact; the earlier /file
//     byte gate was a bad oracle — see
//     docs/regeneration/records/2026-10-01-citation-content-correction.md);
//     wrong content, missing chunks, wrong document identity and a
//     body-derived expected copy are detected; the authenticated unsupported
//     /file 404 stays a permission-boundary negative control.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
// Pure citation-content helpers from the consumer CLI (importing it must not
// run the CLI — main() only runs when the file is the entry point).
import { joinDocumentChunks, evaluateCitationContent } from "../scripts/restore-consumer.mjs";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const CLI = join(repoRoot, "scripts", "restore-consumer.mjs");
const FIXTURE = join(repoRoot, "scripts", "restore-fixture.mjs");

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...extraEnv },
  });
  let json = null;
  const start = (res.stdout || "").indexOf("{");
  if (start >= 0) {
    try { json = JSON.parse(res.stdout.slice(start)); } catch {}
  }
  return { status: res.status, json, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function seedFixture(dir: string) {
  const res = spawnSync(process.execPath, [FIXTURE, "seed", dir], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(res.status, 0, `fixture seed failed: ${res.stderr || res.stdout}`);
}

describe("restore-consumer CLI — pre-boot refusal gates", () => {
  let base: string;
  let seeded: string;

  before(() => {
    base = mkdtempSync(join(tmpdir(), "restore-consumer-test-"));
    seeded = join(base, "seeded");
    mkdirSync(seeded);
    seedFixture(seeded);
  });

  after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {}
  });

  it("gate-only accepts a freshly seeded fixture and leaves the source untouched", () => {
    const res = runCli(["--state-dir", seeded, "--gate-only"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.inputs.gate.refusals.length, 0);
    assert.equal(res.json.inputs.gate.realVerifier.ok, true);
    assert.equal(res.json.cleanup.stateDirUnchanged, true);
    assert.equal(res.json.cli.flags.gateOnly, true);
  });

  it("refuses a directory without sentinel and database before any copy or boot", () => {
    const dir = join(base, "empty");
    mkdirSync(dir);
    const res = runCli(["--state-dir", dir, "--gate-only"]);
    assert.equal(res.status, 1);
    assert.equal(res.json.ok, false);
    const refused = res.json.inputs.gate.refused.join("\n");
    assert.match(refused, /sentinel missing/);
    assert.match(refused, /fixture database missing/);
    // No work directory was created (the refusal precedes prepareWorkDir).
    assert.equal(res.json.inputs.workDir, undefined);
  });

  it("refuses a forged sentinel whose key fingerprint does not match the fixture key", () => {
    const dir = join(base, "forged-sentinel");
    cpSync(seeded, dir, { recursive: true });
    const sentinelPath = join(dir, "restore-fixture.sentinel.json");
    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
    sentinel.keyFingerprint = "0".repeat(64);
    writeFileSync(sentinelPath, JSON.stringify(sentinel, null, 2));
    const res = runCli(["--state-dir", dir, "--gate-only"]);
    assert.equal(res.status, 1);
    const refused = (res.json.inputs.gate.refused ?? []).join("\n");
    assert.match(refused, /key fingerprint does not match/);
  });

  it("refuses a state set missing a synthetic fixture ID (deleted chat message)", () => {
    const dir = join(base, "missing-id");
    cpSync(seeded, dir, { recursive: true });
    const Database = require("better-sqlite3");
    const dbPath = join(dir, "cortex-chat.db");
    const sqlite = new Database(dbPath);
    sqlite.prepare("DELETE FROM chat_messages WHERE id = 'fx-msg-0002'").run();
    sqlite.close();
    for (const s of ["-wal", "-shm"]) {
      try { rmSync(dbPath + s, { force: true }); } catch {}
    }
    const res = runCli(["--state-dir", dir, "--gate-only"]);
    assert.equal(res.status, 1);
    const refused = (res.json.inputs.gate.refused ?? []).join("\n");
    assert.match(refused, /fx-msg-0002 missing from chat_messages/);
  });

  it("refuses a non-quiesced source (WAL sidecar present at open)", () => {
    const dir = join(base, "not-quiesced");
    cpSync(seeded, dir, { recursive: true });
    writeFileSync(join(dir, "cortex-chat.db-wal"), Buffer.alloc(0));
    const res = runCli(["--state-dir", dir, "--gate-only"]);
    assert.equal(res.status, 1);
    const refused = (res.json.inputs.gate.refused ?? []).join("\n");
    assert.match(refused, /quiesce\(cortex-chat\.db-wal\)/);
  });

  it("refuses a canary-carrying (mutated) source via the real verifier", () => {
    const dir = join(base, "mutated");
    cpSync(seeded, dir, { recursive: true });
    const mutateRes = spawnSync(process.execPath, [FIXTURE, "mutate", dir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(mutateRes.status, 0, mutateRes.stderr);
    const res = runCli(["--state-dir", dir, "--gate-only"]);
    assert.equal(res.status, 1);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.inputs.gate.refusals.length, 0, "structural gate passes; the REAL verifier must be the oracle here");
    assert.equal(res.json.inputs.gate.realVerifier.ok, false);
  });

  it("bad usage exits 2 with usage text", () => {
    const res = runCli([]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /usage:/);
    assert.equal(res.json.ok, false);
    const resUnknown = runCli(["--state-dir", seeded, "--nonsense"]);
    assert.equal(resUnknown.status, 2);
  });

  it("rejects a remote/non-loopback --backend-url outright (no fallback, no .env read)", () => {
    const res = runCli(["--state-dir", seeded, "--backend-url", "http://10.12.34.56:8000"]);
    assert.equal(res.status, 2);
    assert.equal(res.json.ok, false);
    assert.match(String(res.json.error), /loopback/);
    // The rejection precedes any copy/build/boot (usage-error shape: no work
    // directory was ever prepared).
    assert.ok(!res.json.inputs?.workDir, "no work dir on usage rejection");
  });

  it("rejects a loopback --backend-url without --document-file (real citation gate is required)", () => {
    const res = runCli(["--state-dir", seeded, "--backend-url", "http://127.0.0.1:8901"]);
    assert.equal(res.status, 2);
    assert.match(String(res.json.error), /--document-file/);
  });

  it("rejects a --document-file that is empty or lacks the stable source sid", () => {
    const empty = join(base, "empty-doc.bin");
    writeFileSync(empty, Buffer.alloc(0));
    const resEmpty = runCli(["--state-dir", seeded, "--backend-url", "http://127.0.0.1:8901", "--document-file", empty]);
    assert.equal(resEmpty.status, 2);
    assert.match(String(resEmpty.json.error), /empty/);

    const noSid = join(base, "no-sid-doc.bin");
    writeFileSync(noSid, Buffer.from("some document content without the marker"));
    const resSid = runCli(["--state-dir", seeded, "--backend-url", "http://127.0.0.1:8901", "--document-file", noSid]);
    assert.equal(resSid.status, 2);
    assert.match(String(resSid.json.error), /fx-source-0001/);
  });

  it("gate-only accepts a valid isolated-backend configuration without booting anything", () => {
    const doc = join(base, "fixture-document.txt");
    writeFileSync(doc, Buffer.from(`source id: fx-source-0001\n${"fixture document body ".repeat(20)}\n`));
    const res = runCli(["--state-dir", seeded, "--gate-only", "--backend-url", "http://localhost:8901", "--document-file", doc]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.cleanup.stateDirUnchanged, true);
    // gate-only exits before any backend connection is attempted.
    assert.equal(res.json.networkTripwire, null);
  });

  it("rejects --app-node that is relative or does not exist", () => {
    const resRel = runCli(["--state-dir", seeded, "--app-node", "node"]);
    assert.equal(resRel.status, 2);
    assert.match(String(resRel.json.error), /absolute/);
    const resMissing = runCli(["--state-dir", seeded, "--app-node", "/nonexistent/node-binary"]);
    assert.equal(resMissing.status, 2);
    assert.match(String(resMissing.json.error), /does not exist/);
  });

  it("gate-only with --app-node validates the path only (no probe, no install)", () => {
    const res = runCli(["--state-dir", seeded, "--gate-only", "--app-node", process.execPath]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.inputs.appNode.path, process.execPath);
    assert.match(String(res.json.inputs.appNode.validated), /path only/);
    // No install ran: gate-only exits before prepareWorkDir.
    assert.equal(res.json.inputs.appInstall, undefined);
    assert.equal(res.json.inputs.workDir, undefined);
  });
});

describe("restore-consumer citation-content helpers — unit controls (fixture pack v2)", () => {
  // Independent mirror of the ACCEPTED MAIN producer declaration (cortex-app
  // source oracle ~1565-71): ONE markdown chunk for fx-source-0001, filename
  // "fixture-source.md". Pinned verbatim — no silent template copy.
  const ACCEPTED_TEXT =
    "Fixture Source content for the disposable restore rehearsal.\n" +
    "It's a \"test\" with escaping: back\\slash and 'quotes'.\n" +
    "The fixture graph cites this document as fx-source-0001 (Fixture Source).\n" +
    "Mentions Rehearsal Alpha and Rehearsal Beta for graph linkage.\n";
  const DOC = {
    id: "fx-source-0001",
    filename: "fixture-source.md",
    chunks: [{ id: "fx-source-0001-chunk-0", chunk_index: 0, content: ACCEPTED_TEXT }],
  };
  // Unit-only synthetic multi-chunk case (NOT the live fixture cardinality —
  // the accepted producer is one chunk; these exercise the generic
  // sort/join/gap logic the SourceModal rule implies).
  const UNIT_MULTI = {
    id: "unit-doc",
    filename: "unit.md",
    chunks: [
      { id: "u-0", chunk_index: 0, content: "alpha" },
      { id: "u-1", chunk_index: 1, content: "beta" },
      { id: "u-2", chunk_index: 2, content: "gamma" },
    ],
  };
  const evaluate = (json: unknown, expectedText = ACCEPTED_TEXT, documentId = "fx-source-0001") =>
    evaluateCitationContent({ json: json as any, documentId, expectedText, expectedFilename: "fixture-source.md" });

  it("healthy content passes: the accepted one-chunk declaration joined by the UI rule is the text itself", () => {
    const ok = evaluate(DOC);
    assert.equal(ok.ok, true, ok.failures.join("; "));
    assert.equal(ok.joined, ACCEPTED_TEXT);
    assert.equal(joinDocumentChunks(DOC.chunks), ACCEPTED_TEXT);
    // Escaping coherence (cross-check with the fixture test's pin).
    assert.ok(ACCEPTED_TEXT.includes("back\\slash"));
  });

  it("unit-only multi-chunk case: unsorted chunks are joined by chunk_index exactly as the UI does", () => {
    const shuffled = { ...UNIT_MULTI, chunks: [...UNIT_MULTI.chunks].reverse() };
    const verdict = evaluate(shuffled, "alpha\n\nbeta\n\ngamma", "unit-doc");
    assert.equal(verdict.ok, false, "unit synthetic doc is not the accepted fixture document");
    assert.equal(joinDocumentChunks(UNIT_MULTI.chunks), "alpha\n\nbeta\n\ngamma");
    // Against its own unit-only expected text the comparator is exact.
    const unitOk = evaluateCitationContent({
      json: shuffled, documentId: "unit-doc",
      expectedText: "alpha\n\nbeta\n\ngamma", expectedFilename: "unit.md",
    });
    assert.equal(unitOk.ok, true, unitOk.failures.join("; "));
  });

  it("negative control: corrupted chunk content is detected against the snapshot", () => {
    const corrupted = {
      ...DOC,
      chunks: [{ ...DOC.chunks[0], content: DOC.chunks[0].content.replace("rehearsal", "MUTATED") }],
    };
    const verdict = evaluate(corrupted);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.failures.some((f) => f.includes("snapshot text")));
    // A forged --document-file that merely copies the corrupted body does NOT
    // legitimize it: comparing against the authoritative text still fails.
    assert.equal(evaluate(corrupted, corrupted.chunks[0].content).ok, true,
      "control: the mutated body only passes against ITSELF (the gate always uses the independent snapshot)");
  });

  it("negative control: a missing chunk (index gap) is detected (unit-only synthetic case)", () => {
    // Middle-chunk gap: indexes 0,2 must be rejected as non-contiguous even
    // before the text comparison.
    const gap = { ...UNIT_MULTI, chunks: UNIT_MULTI.chunks.filter((c) => c.chunk_index !== 1) };
    const verdict = evaluateCitationContent({
      json: gap as any, documentId: "unit-doc",
      expectedText: "alpha\n\nbeta\n\ngamma", expectedFilename: "unit.md",
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.failures.some((f) => f.includes("chunk is missing or duplicated")));
    // Trailing-chunk loss (contiguous indexes) is caught by the text compare.
    const trailing = { ...UNIT_MULTI, chunks: UNIT_MULTI.chunks.filter((c) => c.chunk_index !== 2) };
    const verdict2 = evaluateCitationContent({
      json: trailing as any, documentId: "unit-doc",
      expectedText: "alpha\n\nbeta\n\ngamma", expectedFilename: "unit.md",
    });
    assert.equal(verdict2.ok, false);
    assert.ok(verdict2.failures.some((f) => f.includes("snapshot text")));
  });

  it("negative control: a wrong document id / filename is detected (no unrelated source linkage)", () => {
    const wrongId = evaluate({ ...DOC, id: "fx-unrelated-doc" });
    assert.equal(wrongId.ok, false);
    assert.ok(wrongId.failures.some((f) => f.includes("document identity")));
    const wrongFile = evaluate({ ...DOC, filename: "fixture-source.md.bak" });
    assert.equal(wrongFile.ok, false);
    assert.ok(wrongFile.failures.some((f) => f.includes("filename")));
  });

  it("full_content, when promised, must equal the snapshot text", () => {
    assert.equal(evaluate({ ...DOC, full_content: ACCEPTED_TEXT }).ok, true);
    const verdict = evaluate({ ...DOC, full_content: "wrong" });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.failures.some((f) => f.includes("full_content")));
  });
});
