# 2026-10-02 — Chat ask-route / late-memory journey checks (evaluation slice)

This is the **historical specialist checkpoint**, before integrated execution.
Current verdicts/commands/evidence:
[`2026-10-02-ask-memory-journey.md`](2026-10-02-ask-memory-journey.md). HTTP checks
passed; source-extracted callback + HTTP reproductions confirm F1/F2; intended
page obligations **fail**, browser not-run. Final suite: 122 tests; 94 below is
the earlier specialist-only count.

Owner of this record and of `scripts/chat-memory-checks.ts` +
`tests/chat-memory-oracle.test.ts` only. Runtime infrastructure
(`scripts/chat-journey-runtime.mjs`) is a separate owner's file; no runtime
source, schema, migration, or dependency changes were made; no commits,
deploys, live stores, paid calls.

## Objective and scope

Exercise the REAL public chat boundary over HTTP on a real Next server with
isolated SQLite: `askQuestionStream` (`src/lib/api.ts`) and the chatHistory
functions (`src/lib/chatHistory.ts`) against the real routes
(`/api/ask/stream`, `/api/me/chats*`, `/api/me/projects*`), with a controllable
loopback upstream that can HOLD a late `memory_update` after `done` and release
it manually. Required obligations: done→persist(memory old)→late
memory→re-persist→reload→verbatim next-turn replay; legacy memory-before-done
ordering; answer flags (`refused`/`truncated`/`refusal_source`) round-trip;
source `sid` stability; author validation (forged echo dropped, prior non-null
authors preserved); isolation (foreign 404 + no changes, unauth 401, noGroup
403, project member can continue but cannot title/pin/move/delete);
cross-session non-crossing under delayed interleaved writes; transaction
rollback negative control (duplicate message ids); same-chat concurrency
characterized against the documented last-writer-wins contract (no CAS/revision
guarantee invented); stale full-snapshot replay characterized.

## Evidence class (explicit)

The client callback wiring (memoryRef / doneSeen / persist-on-done /
re-persist-on-late-memory) in `scripts/chat-memory-checks.ts` is a **TEST
DRIVER** replicating the documented `page.tsx` wiring
(`src/app/page.tsx:499-615`). It is NOT the actual page and NOT a browser.
The checks prove HTTP persistence + parser + driver-wiring behavior; they
establish **no browser/render evidence**. The page.tsx race analysis below is
code-path/event-order analysis, not a browser reproduction.

## Files (this slice's write scope)

- `scripts/chat-memory-checks.ts` — exported `async runMemoryChecks(ctx)`;
  returns `{ checks: [{id, ok, detail}], findings: [...] }`; individual
  assertions are caught by a local `add` helper so one failure retains the
  remaining obligation evidence.
- `tests/chat-memory-oracle.test.ts` — deterministic, HTTP-free
  persistence-wiring oracle: healthy control (real parser + documented wiring
  re-persists the late blob verbatim; legacy order = exactly one persist in
  onDone) and the test-only return-at-done mutant
  (`tests/fixtures/api-return-at-done.ts`) rejected by the oracle's own
  assertion (import outside the rejection check; `/persist/` obligation). No
  shared src mutated.
- this record.

## ctx contract consumed (per scripts/chat-journey-runtime.mjs)

```
baseUrl : string                       // loopback http base of the real Next server (next dev)
dataDir : string                       // isolated SQLite dir backing that server
workDir : string                       // scratch
ids     : Record<string,string>        // fixture/augment ids (prefilled by the runtime)
users   : { owner|member|foreign|noGroup: {id,email,password} }  // pre-provisioned
request(path, {method?, cookie?, body?, headers?, timeoutMs?}) => Response
    // same-origin paths only; body is a JSON-serializable OBJECT (or a string
    // sent verbatim); the runtime serializes objects, sets
    // Content-Type: application/json and Cookie, and bounds every request
    // with AbortSignal.timeout(timeoutMs ?? requestTimeoutMs).
requestTimeoutMs : number              // runtime-configurable (runner sets 60k
                                       // as the warm/first-compile allowance)
upstream.requests : record[]           // EVERY upstream hit; record.body is
                                       // the PARSED JSON object (or null) —
                                       // never a string; never re-parsed.
upstream.setHandler(fn(req,res,record)) // function ONLY (null refused by the
                                       // runtime); a handler that returns
                                       // without ending the response is HELD
                                       // in upstream.pending (key record.id).
upstream.release(id, frames)           // writes frames (objects or raw
                                       // strings), ends the response and
                                       // clears the pending entry. Held late
                                       // memory MUST be delivered this way —
                                       // a manual res.end() would leave the
                                       // pending entry set and fail run
                                       // finalization.
```

Checks module uses a **bounded temporary fetch adapter** while the real
`askQuestionStream`/chatHistory run: relative URLs map to `ctx.baseUrl`, the
scenario user's `cortex_session` cookie is attached, any non-loopback absolute
target is rejected, and every operation is bounded with
`AbortSignal.timeout(ctx.requestTimeoutMs)` combined with any caller signal
(`AbortSignal.any`). The adapter is always restored in `finally`. Login is done
through the real `POST /api/auth/login` with the runner's warm allowance.
`setChatStorageMode("server")` is set explicitly by the module. Concurrency
checks assert each concurrent writer's HTTP status individually (no inferred
commits); the read-only SQLite probe treats the store as a hard prerequisite
and always closes its connection in `finally`.

## Check inventory (ids returned by runMemoryChecks)

env.login.{owner,member,foreign,noGroup}; turn1.{setup-chat-and-handler,
persist-memory-old-before-late, late-memory-repersisted,
reload-verbatim-memory-and-sources, upstream-stripped-and-keyed};
turn2.replays-late-blob-verbatim; legacy.memory-before-done-single-persist;
flags.refused-truncated-source-persisted; isolation.{foreign-404-and-no-changes,
unauth-and-noGroup, concurrent-sessions-never-cross};
project.member-continues-cannot-administer;
concurrency.{same-chat-last-writer-wins-paired,
stale-full-snapshot-replay-characterized}; rollback.duplicate-message-ids-atomic;
authors.forged-echo-dropped-and-history-preserved.

## How to run

Through the lead's runner `scripts/chat-journey-checks.ts` (which imports
`scripts/chat-journey-runtime.mjs` and this module and owns the CLI/exit
discipline):

```
node --import tsx scripts/chat-journey-checks.ts   # lead-owned runner; supplies ctx
```

The checks module itself must not boot servers or own upstream sockets.

## Executed evidence (historical specialist-only checkpoint)

- `npm run typecheck` — pass (whole repo; tests/ included, scripts/ excluded by
  tsconfig, so the checks module was additionally verified with an equivalent
  strict config in scratch: `npx tsc --noEmit -p
  /var/tmp/cortex-qa-tmp/tsconfig.chat-memory-checks.json` — pass).
- `npm test` (node:test via `scripts/run-tests.mjs`, `TMPDIR=/var/tmp/cortex-qa-tmp`)
  — **94/94 pass, 0 fail** (was 90; +4 new: two healthy persistence-wiring
  controls, one negative control against the return-at-done mutant, one
  parser-oracle cross-check).
- The HTTP journey suite itself is **not-run** in this session: it requires the
  lead's runner (`scripts/chat-journey-checks.ts`) + real Next server +
  isolated SQLite, which is executed at the integrated lead step. This is a
  declared not-run of the journey checks, not a pass; the deterministic oracle
  evidence above does not substitute for it.
- Lead review (pre-execution) corrected the checks module against the real
  runtime contract before any run: parsed `record.body` (no re-parse), held
  late memory delivered via `upstream.release(record.id, frames)` instead of a
  manual `res.end()` (which would strand `upstream.pending` and fail run
  finalization), `setHandler` function-only, runner-side warm
  `requestTimeoutMs` allowance for first-hit route compilation, awaited
  legacy-scenario persistence with a full healthy snapshot, full turn1+turn2
  history retention with the forged-echo assertion judged on the turn-2
  message id, per-writer HTTP-success assertions for all concurrent/stale
  writes (actual `Promise.all` waves, no sequential-sleep simulation), a hard
  (not advisory) read-only SQLite probe with `finally` close, and
  `AbortSignal.timeout` bounds on every adapter operation. No browser claim
  attaches to any candidate finding.

## Findings (returned in the findings array; preserved, NOT fixed)

### F1 — page.tsx race: late memory re-persist snapshots the NEXT turn's in-flight state (candidate defect)

Turn 1 `done` → `onDone` sets `isLoading=false` (page.tsx:637) and persists
(`doneSeen=true`). `isLoading=false` admits a second send (guard
page.tsx:401). While turn 2 streams, turn 1's late `onMemoryUpdate` fires
(page.tsx:602-615): it overwrites the shared `memoryRef.current` and calls
`setMessages(prev => { finalize(prev); return prev })` — `finalize` persists
whatever is in state at that instant (page.tsx:499-505), i.e. turn 2's messages
INCLUDING the streaming assistant bubble (`isStreaming: true`, partial
content). If the tab closes before turn 2 settles, the DB keeps partial assistant
content (`isStreaming` is dropped, so it looks settled); a project-chat reload reads this as
the fresh-merge base (page.tsx:410-417). Self-heals only if turn 2 later
settles a full replace.

### F2 — page.tsx race: late memory_update lands during regenerate/edit and defeats the memoryAtSend snapshot (candidate defect)

User clicks regenerate BEFORE the late blob lands. Regenerate restores
`memoryRef.current = memoryAtSendRef.current` (page.tsx:785) per the documented
incident constraint. Then turn 1's late `onMemoryUpdate` unconditionally sets
`memoryRef.current` to turn 1's post-answer blob (page.tsx:604) and, with
`doneSeen=true`, persists the regenerate's in-flight thread together with the
pre-redo memory; the redo turn's own `onDone` finalize (page.tsx:634) then
persists `memoryRef.current` — the answer the redo was meant to forget.
Violates the documented "regenerate does not remember the answer it replaces"
constraint; same mechanism applies to edit-last.

### F3 — observation: finalize() runs inside a setMessages updater

Both `onDone` and the late-memory path call `finalize` inside the
`setMessages` updater (page.tsx:609-615, 616-638). React may invoke updaters
more than once (StrictMode dev), emitting the persistence PATCH twice — benign
today (PATCH is an idempotent full replace) but a network side effect in
render-phase code; fold into the same follow-up.

### F4 — characterization: same-chat last-writer-wins, coherent pair

Two concurrent full-snapshot PATCHes (messages+memory folded in one transaction
each) resolve to one writer's coherent (messages, memory) pair; matches the
documented same-chat LWW contract (chat-streaming-memory guide, live-turn
section). No CAS/revision guarantee exists and none was invented.

### F5 — characterization: stale full-snapshot replay reverts a newer settled turn

A stale (messages, memory) snapshot PATCHed after a newer settled turn
overwrites both — the HTTP-level shape that findings F1/F2 can produce. The
contract documents LWW, so this is characterized, not fixed; F1/F2 are the
client-side defects that make the server's documented LWW harmful in real UI
sequences.

## Follow-up record (separately scoped; do not fix inside evaluation slices)

Scope: `src/app/page.tsx` late-memory callback wiring only. Intended behavior:
the late `memory_update` of turn N must (a) not overwrite a memory snapshot
restored by regenerate/edit (memoryAtSendRef must win until the redo turn's own
blob arrives), and (b) never persist a message list containing an in-flight
streaming assistant bubble from a later turn. Suggested direction (for the
follow-up owner to evaluate; not committed here): stamp persists with a turn
id/generation captured at send time, ignore late memory_update whose turn is no
longer the latest, and move `finalize` out of the setMessages updater.
Acceptance: deterministic wiring oracle extended to the two race event orders
(healthy + mutant-style stale-persist fixture), plus the HTTP journey
concurrency checks re-run. Severity justification: F2 violates a documented
incident constraint (silent memory contamination across regenerate); F1
pollutes persisted threads in a realistic fast-follow-up sequence. Neither is
reproduced in a browser in this slice — that reproduction belongs to the
follow-up.

## Limits

Limits below describe the historical specialist stage; integrated coverage and
current remaining gaps are in the owning journey receipt linked at the top.

- No full-server execution, no browser evidence, no LLM/model calls: journey
  checks not-run pending the lead's runner + integrated lead step.
- `upstream.requests` records expose the FORWARD body as a PARSED object
  (post-strip, post-injection) — asserted accordingly (stripped ids, injected
  `X-API-Key`, `Accept-Encoding: identity`, `X-Request-ID` echo).
- The read-only SQLite probe is a hard assertion in the runtime environment
  (the isolated store is a runtime prerequisite); it opens read-only and
  always closes in `finally`. Outside that environment a missing store fails
  the check rather than being skipped.
- The persisted memory blob is opaque by contract; checks only assert
  verbatim deep-equality, never interpretation.
- Demo throttle, live-turn relay SSE feed, souls/projects injection content,
  voice, and OIDC/reset flows are out of this slice's scope.

## Historical handoff (completed by integrated run D)

Integrated lead step: run the lead's runner `scripts/chat-journey-checks.ts`
(`node --import tsx scripts/chat-journey-checks.ts`, loopback only,
`TMPDIR=/var/tmp/cortex-qa-tmp`), capture the structured `checks`/`findings`
output into a follow-up record, and route F1/F2 to the page.tsx follow-up
slice above.
