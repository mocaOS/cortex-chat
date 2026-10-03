import { test } from "node:test";
import assert from "node:assert/strict";
import { runV2LateMemoryContract } from "./helpers/late-memory-contract";
import { MINIMAL_ASK, heldSseResponse, sseFrame } from "./helpers/sse";
import type { AskRequest } from "@/types";
import type { StreamCallbacks } from "@/lib/api";

/*
 * Persistence-wiring oracle for the backend-v2 late-memory journey (playbook
 * §9): the parser-level oracle (tests/helpers/late-memory-contract.ts) proves
 * the late blob is DELIVERED after `done`; this oracle additionally proves the
 * DOCUMENTED page.tsx persistence wiring around it:
 *
 *   - on `done`  -> persist the turn with the memory AS OF done (the old blob),
 *   - on a late `memory_update` (after done) -> re-persist with the fresh blob,
 *   - legacy order (memory_update before done) -> exactly ONE persist, in
 *     onDone, already carrying the fresh blob.
 *
 * EVIDENCE CLASS (explicit): the "persistence" here is a TEST DRIVER that
 * replicates the documented page.tsx wiring (src/app/page.tsx:499-615) against
 * a mocked transport. This is deterministic HTTP-free contract evidence for
 * the wiring obligation — NOT the actual page, NOT a browser, and NOT the
 * real server persistence journey (that is scripts/chat-memory-checks.ts run
 * through scripts/chat-journey-runtime.mjs).
 *
 * Healthy control and negative control run the SAME oracle; the only variable
 * is the implementation behind the askQuestionStream entry boundary. The
 * negative control uses the retained test-only fixture
 * tests/fixtures/api-return-at-done.ts (the pre-incident "return at done"
 * parser) — shared src is never mutated.
 */

const MEMORY_BLOB = { summary: "turn 1", ledger: ["opaque"] };

interface PersistRecord {
  at: "done" | "late-memory";
  memory: unknown;
}

// Driver replicating page.tsx: persist on done with memoryRef AS OF done;
// re-persist when a late memory_update lands after doneSeen.
async function runLateMemoryPersistenceJourney(
  ask: (req: AskRequest, cb: StreamCallbacks) => Promise<void>,
  scenario: "v2-late" | "legacy"
): Promise<PersistRecord[]> {
  const realFetch = globalThis.fetch;
  const persists: PersistRecord[] = [];
  let memoryRef: unknown = undefined;
  let doneSeen = false;
  globalThis.fetch = async () => {
    if (scenario === "v2-late") {
      return heldSseResponse(
        [
          sseFrame({ content: "Hello " }),
          sseFrame({ content: "world" }),
          sseFrame({ done: true, pending_memory: true }),
        ],
        25,
        [sseFrame({ memory_update: MEMORY_BLOB })]
      );
    }
    return heldSseResponse(
      [
        sseFrame({ content: "Legacy answer" }),
        sseFrame({ memory_update: MEMORY_BLOB }),
        sseFrame({ done: true }),
      ],
      0,
      []
    );
  };
  try {
    await ask(MINIMAL_ASK, {
      onContent: () => {},
      onSources: () => {},
      onGraphContext: () => {},
      onThinking: () => {},
      onSubQuestions: () => {},
      onRetrieval: () => {},
      onRetrievalStats: () => {},
      onStatus: () => {},
      onMemoryUpdate: (memory) => {
        memoryRef = memory;
        if (doneSeen) persists.push({ at: "late-memory", memory });
      },
      onDone: () => {
        doneSeen = true;
        persists.push({ at: "done", memory: memoryRef });
      },
      onError: (error) => {
        throw new Error(`unexpected onError: ${error}`);
      },
    });
    return persists;
  } finally {
    globalThis.fetch = realFetch;
  }
}

function assertLateMemoryPersistenceJourney(persists: PersistRecord[]): void {
  // 1. exactly two persists: one at done (stale/old memory), one when the
  //    late blob lands — otherwise the late turn memory is lost on reload.
  assert.equal(
    persists.length,
    2,
    "the journey must persist once at done and once more when the late memory lands"
  );
  // 2. the done-time persist must NOT already carry the late blob (it cannot
  //    — it arrives later) and must not carry some other constructed value.
  assert.equal(
    persists[0].at,
    "done",
    "the first persist must happen in onDone"
  );
  assert.notDeepEqual(
    persists[0].memory,
    MEMORY_BLOB,
    "at done time the late blob has not arrived yet — the persist must carry the old memory"
  );
  // 3. the final persisted memory must be the late blob VERBATIM (opaque —
  //    never reconstructed, never dropped).
  assert.deepEqual(
    persists[1].memory,
    MEMORY_BLOB,
    "the late memory blob must be persisted verbatim"
  );
}

test("healthy control: real parser + documented persistence wiring re-persists the late memory verbatim", async () => {
  const { askQuestionStream } = await import("@/lib/api");
  const persists = await runLateMemoryPersistenceJourney(askQuestionStream, "v2-late");
  assertLateMemoryPersistenceJourney(persists);
});

test("healthy control (legacy order): memory before done persists exactly once in onDone with the fresh blob", async () => {
  const { askQuestionStream } = await import("@/lib/api");
  const persists = await runLateMemoryPersistenceJourney(askQuestionStream, "legacy");
  assert.deepEqual(
    persists,
    [{ at: "done", memory: MEMORY_BLOB }],
    "legacy order: doneSeen stays false during onMemoryUpdate — one persist, carrying the pre-done blob"
  );
});

test("negative control: the return-at-done mutant loses the late memory persist — the oracle's own assertion rejects it", async () => {
  // Import OUTSIDE assert.rejects so a module-resolution failure can never be
  // mistaken for the gate rejecting the mutant's behavior.
  const mutantModule = await import("./fixtures/api-return-at-done");
  await assert.rejects(
    () => runLateMemoryPersistenceJourney(mutantModule.askQuestionStream, "v2-late").then(
      (persists) => assertLateMemoryPersistenceJourney(persists)
    ),
    (err: unknown) =>
      err instanceof assert.AssertionError &&
      /persist/.test(String(err.message)),
    "the oracle must reject the mutant for the late-memory PERSISTENCE obligation itself (transport-level delivery is already covered by the parser oracle)"
  );
});

test("cross-check: the shared parser-level oracle still passes for the healthy implementation (same conditions as the negative control)", async () => {
  // Keeps this file's healthy baseline aligned with the parser oracle so the
  // two evidence levels (delivery + persistence wiring) stay coupled.
  const { askQuestionStream } = await import("@/lib/api");
  await runV2LateMemoryContract(askQuestionStream);
});
