import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertHealthySettledRetention,
  assertLegacySinglePersist,
  assertNoLaterInflightPersisted,
  assertRestoredSnapshotUntouched,
  assertSessionBoundLateRetention,
  createRecordingPageAdapter,
  extractPageCallbackExpressions,
  type PageLateOutcome,
} from "../scripts/chat-page-callback-probe";
import {
  PAGE_LATE_CALLBACK_BASELINE_EXPRESSIONS,
  PAGE_LATE_CALLBACK_BASELINE_PROVENANCE,
  buildBaselinePageLateCallbacks,
} from "./fixtures/page-late-callback-baseline";

/*
 * Positive deterministic oracles for the page late-callback obligations
 * (playbook §9.5/§13.3), shared with the HTTP probe
 * (scripts/chat-page-callback-probe.ts) that will judge the authorized fix.
 *
 * This file proves, against the RETAINED defective baseline
 * (tests/fixtures/page-late-callback-baseline.ts — frozen page.tsx
 * expressions with page-hash/git-blob provenance):
 *
 *   - healthy controls: the baseline passes the settled and legacy oracles
 *     (the fix must preserve these);
 *   - negative controls: the baseline is REJECTED by the intended
 *     positive oracles at their own assertions — AssertionError with the
 *     obligation message, never an extraction or transport error (the
 *     fixture embeds the expressions and runs with no transport at all).
 *
 * The baseline module is imported statically OUTSIDE any rejection check, so
 * a module failure can never masquerade as an intended rejection.
 */

const repoRoot = join(dirname(dirname(fileURLToPath(import.meta.url))));

const u = (id: string) => ({ id, role: "user", content: `question ${id}` });

function driver(sessionId: string, assistantId: string) {
  const adapter = createRecordingPageAdapter();
  const callbacks = buildBaselinePageLateCallbacks({
    sessionId, assistantId,
    memoryRef: adapter.memoryRef,
    setMessages: adapter.setMessages,
    updateChatMessages: adapter.updateChatMessages,
  });
  return { adapter, callbacks };
}

const isAssertionAbout = (err: unknown, obligation: RegExp) =>
  err instanceof assert.AssertionError && obligation.test(String(err.message));

test("provenance: retained baseline expressions are the frozen git-blob page.tsx, byte-exact", () => {
  const { pageTsGitBlob, pageTsSha256 } = PAGE_LATE_CALLBACK_BASELINE_PROVENANCE;
  const source = execFileSync("git", ["cat-file", "-p", pageTsGitBlob], {
    cwd: repoRoot,
  }).toString();
  assert.equal(
    createHash("sha256").update(source).digest("hex"), pageTsSha256,
    "the retained git blob must hash to the recorded frozen page hash"
  );
  const extracted = extractPageCallbackExpressions(
    source, ["finalize", "onMemoryUpdate", "onDone"]
  );
  assert.deepEqual(extracted, PAGE_LATE_CALLBACK_BASELINE_EXPRESSIONS,
    "fixture expressions drifted from the frozen page.tsx blob — re-derive the fixture from the recorded provenance");
});

test("healthy control: baseline passes the settled-retention oracle (fix must preserve)", async () => {
  const { adapter, callbacks } = driver("sess-healthy", "a1");
  adapter.messages = [u("u1"), { id: "a1", role: "assistant", content: "answer a1", isStreaming: true }];
  adapter.memoryRef.current = { marker: "blob-as-of-done" };
  callbacks.onDone({});
  const late = { marker: "late-blob" };
  callbacks.onMemoryUpdate(late);
  await adapter.drain();
  const outcome: PageLateOutcome = adapter.outcome();
  // Precondition: the healthy schedule really persisted the turn.
  assert.ok(outcome.writes.length >= 1, "healthy schedule must produce a persist");
  assertHealthySettledRetention("sess-healthy", outcome, {
    settledMessageIds: ["u1", "a1"], lateBlob: late,
  });
});

test("healthy control: baseline passes the legacy single-persist oracle (fix must preserve)", async () => {
  const { adapter, callbacks } = driver("sess-legacy", "a1");
  adapter.messages = [u("u1"), { id: "a1", role: "assistant", content: "answer a1", isStreaming: true }];
  adapter.memoryRef.current = { marker: "stale" };
  // Legacy order: memory_update arrives BEFORE done — no persist yet.
  callbacks.onMemoryUpdate({ marker: "fresh" });
  assert.equal(adapter.writes.length, 0,
    "legacy order precondition: nothing persists before done");
  callbacks.onDone({});
  await adapter.drain();
  assertLegacySinglePersist("sess-legacy", adapter.outcome(), {
    settledMessageIds: ["u1", "a1"], freshBlob: { marker: "fresh" },
  });
});

test("negative control: baseline rejected — no later in-flight answer persisted by a prior turn's callback", async () => {
  const { adapter, callbacks } = driver("sess-next", "a1");
  adapter.messages = [u("u1"), { id: "a1", role: "assistant", content: "answer a1", isStreaming: false }];
  adapter.memoryRef.current = { marker: "pre-answer-snapshot" };
  callbacks.onDone({});
  // Turn N+1 is in-flight when turn N's late blob lands.
  adapter.messages = [...adapter.messages,
    u("u2"),
    { id: "a2-partial", role: "assistant", content: "partial next answer", isStreaming: true }];
  callbacks.onMemoryUpdate({ marker: "turn-1-late-blob" });
  await adapter.drain();
  const outcome = adapter.outcome();
  // Defect signature observed before the gate is claimed sensitive.
  assert.ok(outcome.writes.some(w => (w.messages as Array<{ id?: unknown }>).some(m => m?.id === "a2-partial")),
    "baseline precondition: the in-flight answer was actually persisted");
  assert.throws(
    () => assertNoLaterInflightPersisted("sess-next", outcome, ["a2-partial"]),
    (err: unknown) => isAssertionAbout(err, /late prior-turn callback must not persist a later turn's in-flight answer/),
    "the intended oracle must reject the baseline at its own assertion, not via extraction/transport error"
  );
});

test("negative control: baseline rejected — regenerate restored snapshot clobbered by superseded callback", async () => {
  const { adapter, callbacks } = driver("sess-regen", "a1");
  adapter.messages = [u("u1"), { id: "a1", role: "assistant", content: "answer a1", isStreaming: false }];
  adapter.memoryRef.current = { marker: "after-answer" };
  callbacks.onDone({});
  callbacks.onMemoryUpdate({ marker: "turn-1-late-blob" });
  await adapter.drain();
  // Regenerate restores the pre-turn snapshot; redo starts in-flight.
  const snapshot = { marker: "pre-answer-snapshot" };
  const windowStart = adapter.mark();
  adapter.memoryRef.current = snapshot;
  adapter.messages = [u("redo-u"), { id: "redo-a", role: "assistant", content: "partial redo", isStreaming: true }];
  const superseded = { marker: "superseded-post-answer" };
  callbacks.onMemoryUpdate(superseded);
  await adapter.drain();
  const windowOutcome = adapter.outcome(windowStart);
  // Defect signature observed before the gate is claimed sensitive.
  assert.deepEqual(adapter.memoryRef.current, superseded,
    "baseline precondition: the restored snapshot was actually clobbered in the ref");
  assert.throws(
    () => assertRestoredSnapshotUntouched(windowOutcome, snapshot),
    (err: unknown) => isAssertionAbout(err, /restored regenerate\/edit snapshot/),
    "the intended oracle must reject the baseline at its own assertion, not via extraction/transport error"
  );
});

test("negative control: baseline rejected — edit-last restored snapshot clobbered by superseded callback", async () => {
  const { adapter, callbacks } = driver("sess-edit", "a1");
  adapter.messages = [u("u1"), { id: "a1", role: "assistant", content: "answer a1", isStreaming: false }];
  adapter.memoryRef.current = { marker: "after-answer" };
  callbacks.onDone({});
  callbacks.onMemoryUpdate({ marker: "turn-1-late-blob" });
  await adapter.drain();
  const snapshot = { marker: "pre-answer-snapshot" };
  const windowStart = adapter.mark();
  adapter.memoryRef.current = snapshot;
  adapter.messages = [u("edit-redo-u"), { id: "edit-redo-a", role: "assistant", content: "partial redo", isStreaming: true }];
  const superseded = { marker: "superseded-post-answer" };
  callbacks.onMemoryUpdate(superseded);
  await adapter.drain();
  const windowOutcome = adapter.outcome(windowStart);
  assert.ok(windowOutcome.writes.some(w => w.memory !== snapshot && w.memory !== undefined),
    "baseline precondition: a window write carried the superseded blob");
  assert.throws(
    () => assertRestoredSnapshotUntouched(windowOutcome, snapshot),
    (err: unknown) => isAssertionAbout(err, /restored regenerate\/edit snapshot/),
    "the intended oracle must reject the baseline at its own assertion, not via extraction/transport error"
  );
});

test("negative control: baseline rejected — late callback persists the active session's messages into its origin session", async () => {
  const { adapter, callbacks } = driver("sess-origin", "a1");
  const aMessages = [u("a-u1"), { id: "a-a1", role: "assistant", content: "answer a-a1", isStreaming: false }];
  const bMessages = [u("b-u1"), { id: "b-a1", role: "assistant", content: "answer b-a1", isStreaming: false }];
  adapter.messages = aMessages;
  adapter.memoryRef.current = { marker: "origin-blob-as-of-done" };
  callbacks.onDone({});
  callbacks.onMemoryUpdate({ marker: "turn-1-late-blob" });
  await adapter.drain();
  // User switches to chat B; then chat A's late blob lands.
  const windowStart = adapter.mark();
  adapter.memoryRef.current = { marker: "foreign-session-memory" };
  adapter.messages = bMessages;
  const lateA = { marker: "origin-late-blob" };
  callbacks.onMemoryUpdate(lateA);
  await adapter.drain();
  const windowOutcome = adapter.outcome(windowStart);
  // Defect signature observed before the gate is claimed sensitive.
  assert.ok(windowOutcome.writes.some(w =>
    w.sessionId === "sess-origin" &&
    (w.messages as Array<{ id?: unknown }>).some(m => m?.id === "b-u1")),
    "baseline precondition: the active session's messages were actually persisted into the origin session");
  assert.throws(
    () => assertSessionBoundLateRetention("sess-origin", windowOutcome, {
      lateOriginMemory: lateA,
      originMessageIds: ["a-u1", "a-a1"],
      foreignMessageIds: ["b-u1", "b-a1"],
    }),
    (err: unknown) => isAssertionAbout(err, /originating (?:session|turn's own)/),
    "the intended oracle must reject the baseline at its own assertion, not via extraction/transport error"
  );
});
