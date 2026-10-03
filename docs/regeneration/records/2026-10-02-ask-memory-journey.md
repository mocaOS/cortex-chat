# Chat ask routes + late-memory persistence — 2026-10-02

Mode **translate**, evaluation improvement on unchanged production baseline.
Run of record **`chat-ask-memory-20261002-d`**, exit 0: scoped HTTP route and
persistence obligations passed. **Two page orchestration obligations fail** in
source-extracted callback reproductions. They remain defects, not accepted
behavior. Browser acceptance is **not-run**.

## Intent, boundary and baseline

Close structural-only confidence for both ask proxies, then prove done → held
late memory → acknowledged persistence → HTTP reload → next-turn replay. Chat
owns SQLite identity/history and encrypted backend keys; the loopback fixture
owns upstream verdicts/SSE timing. Real Next middleware, cookies, handlers,
migrations, crypto, parser and history clients execute.

Production source, schemas, migrations, configs, defaults and dependency resolution
are unchanged. Existing dirty work retained. Bases: app
`bd6c1e035b3e6ece7741a0b733bfd8735145f846`; Chat
`40fe79799c4729c4b695890566ef3a51746b3b5e`; skills
`1156aded6726d6105cb13a72ded93efaf55f5bef`. No commits, deployments, publication,
live stores or paid/model calls. K was not rerun; its scripts remain unchanged.

Benefit hypothesis: the next proxy/callback change reuses a real request and
persistence gate without rediscovering Next/auth/SQLite setup. Filling the gap
exposed defects; future-change cost reduction is not yet measured. No replacement
or reconstruction attempted. Original runtime stayed the baseline throughout;
there is no before/after runtime candidate comparison.

## Frozen gate and demonstrated obligations

| Obligation | Result / independent observable oracle |
|---|---|
| ASK-AUTH | Both routes: anonymous/invalid/expired session 401, group-less user 403, **zero upstream hits**; real password login healthy controls |
| ASK-FORWARD | Exact caller group key, including foreign group; request ID reuse/mint/echo; SSE `Accept-Encoding: identity`; caller Authorization absent; opaque fields unchanged |
| ASK-LOCAL | `session_id`, `assistant_id`, `project_id` absent upstream on **both** routes; generic ask preserves original history |
| ASK-SCOPE | Scoped key denied off-collection, all-scope healthy control succeeds. Generic rejects locally; stream delegates to fixture backend under scoped key. Not live backend/Cypher evidence |
| ASK-ALLOW | Six forbidden method/path controls 404 with zero upstream hits (admin keys, generic stream, search, citation `/file`, GET ask and ask/extra) |
| ASK-CONTEXT | Exact Unicode analytics → usable soul → member-project instructions → history; foreign project/private soul not injected. Inaccessible context ignored, not ask 403 |
| ASK-ERROR | 401/403/429/500 verdicts, Retry-After and correlation preserved; each exactly one hit |
| MEM-LATE | Real parser/history clients; answer GET-visible before release; late blob re-persisted; reload/next request exact replay; prior history and stable source `sid` retained |
| MEM-LEGACY/FLAGS | Memory-before-done persists once; refusal/source/truncation metadata round-trips |
| MEM-ISOLATE | Foreign-group **and same-group** private-chat GET/PATCH/DELETE 404 with no change; project member may continue, cannot title/pin/move/delete; forged authors ignored, prior non-null authors preserved |
| MEM-CONCURRENT | Actual concurrent PATCH waves across two sessions retain distinct messages/memory; same-chat writes retain one coherent pair; every writer's 200 asserted |
| MEM-STALE | Stale full-snapshot replay overwrites newer state: documented LWW characterization, **not** CAS/stale rejection |
| MEM-ROLLBACK | Duplicate IDs fail; messages/memory unchanged through HTTP **and required read-only SQLite** |
| PAGE-LATE-ISOLATION | **FAIL**: prior callback persists a later turn's partial assistant content |
| PAGE-REGENERATE | **FAIL**: superseded callback replaces restored pre-turn snapshot |

**62 executed rows = 38 ask + 21 memory + 3 callback probes**. The probes are
one healthy settled-turn control and two successful **defect confirmations**.
`claim-verdicts.json` distinguishes failed product obligations from passing
evaluation execution. Never call this 62 product obligations passed. All IDs and
observations survive in `results.json`; the frozen scenario sources define the
accepted selection, without skip/setup-error substitutions.

Before integrated judgment, healthy forwarding/late-memory oracles and isolated
controls rejected each leaked local ID, forged key, gzip, lost opaque memory and
the maintained return-at-done mutant at their intended assertions. The original
90 contract tests remain included in the final **122-test** suite.

## Minimal reproductions and separately scoped follow-up

`scripts/chat-page-callback-probe.ts` AST-extracts the **actual** `finalize` and
`onMemoryUpdate` expressions from `page.tsx`, binds their dependencies and executes
them with a synchronous state-updater adapter and real HTTP PATCH/GET. Extraction
or transport failure cannot masquerade as intended assertion rejection. This is
source-assisted callback + HTTP evidence, **not React/browser evidence**. The
healthy settled control uses the same callback.

1. `doneSeen=true`; turn N+1 has an in-flight assistant; turn N's late callback
   runs. `finalize(prev)` persists the current list including `partial next answer`.
   The route drops `isStreaming`, so reload treats it as ordinary persisted content.
   The no-later-inflight-content oracle rejects the observed state.
2. Regenerate restores `{marker:"pre-answer-snapshot"}`; old callback then changes
   ref/storage to `{marker:"superseded-post-answer"}`. Snapshot-preservation oracle
   rejects it. The already-sent redo request is not retroactively changed;
   subsequent ref/persistence is contaminated.

Owners: `page.tsx:499–505,602–637,775–803`; initial analysis:
[`2026-10-02-memory-findings.md`](2026-10-02-memory-findings.md).
Follow-up: bind callbacks/persistence to their originating turn/session; preserve
regenerate/edit-last snapshots, visible completion, legacy SSE, opaque memory,
supported UI flows and server LWW. Do not silently introduce schema/CAS promises.
Obtain actual browser reproductions with held loopback SSE: rapid next-send,
regenerate/edit-last and chat-switch.

**Probe exit condition:** the two reproductions intentionally require the known
defects. In an authorized fix slice retain this baseline and convert them to
positive intended-behavior gates **before** judging a fix. Do not delete or relax
the failing obligations to retain a green run.

## Exact verification / replay

From `cortex-chat`, existing dependencies required; choose fresh evidence/run ID:

```bash
TMPDIR=/var/tmp/cortex-qa-tmp node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-journey.json
TMPDIR=/var/tmp/cortex-qa-tmp npm run typecheck
TMPDIR=/var/tmp/cortex-qa-tmp npm test
TMPDIR=/var/tmp/cortex-qa-tmp node --import tsx scripts/chat-journey-checks.ts /home/clippy/coding/cortex-app/output/chat-ask-memory-20261002-d chat-ask-memory-20261002-d
```

Typechecks exit 0; suite **122 passed, 0 failed/cancelled/skipped**. Journey exit
0: 62 rows, errors/drift/unexpected paths `[]`, pending responses released, owned
process stopped, scratch removed **after** evidence retention. `git diff --check`
passed in all three repos. Runtime tracked diffs: app `backend/app`/`frontend/src`,
Chat `src`/configs/lock, skills source trees empty. App/SDK/MCP product suites
not rerun because their runtime inputs did not change; no new claim for them.

Runtime: Node **22.22.3**, Next **16.1.7** default Turbopack **`next dev`**, React
19.2.4, better-sqlite3 12.9.0, argon2 2.0.2. Private verbatim dependency copy,
**no install/resolution change**; actual SQLite write/read and PHC hash smoke.
Not clean-build, CI Node 20 or production Alpine/musl evidence.

## Evidence identity and retention

App-relative directory:
`output/chat-ask-memory-20261002-d/chat-journey-chat-ask-memory-20261002-d-2026-10-02T08-10-01-494Z/`.
Retain `results.json`, `claim-verdicts.json`, `findings.json`, `app-dev.log`, network
tripwire JSONL and generated fixture/tripwire provenance. Local artifacts ignored
by `output/.gitignore`; not off-host or guaranteed durable. This record and accepted
replay scripts survive scratch independently.

| Input/result | SHA-256 |
|---|---|
| `results.json` | `42b1474a65c2e4b77895b6677d85086565c05bb5e9335d3028e40392cce6dbf9` |
| `claim-verdicts.json` | `f7b531967b8ba642e6098282f2cc5c2124f32f2690e49946e5cfbc7687416ed6` |
| source manifest (219 files) | `6684037d5338682ab8da0f85f4bf3e3ec168ede246c5732c157a76885284c0f2` |
| package lock | `9fd1310d2bbd95abce965d71946af8acd52d4a29a7e1682515016dd1cc33e9f2` |
| installed lock | `051c9fbcf674f85649a110c813014c0077b4df9cd7ac4e26898bb030dae91fe2` |
| `chat-journey-runtime.mjs` | `7fe11a1eed5d133d1a2e6f8070d30ca52fb134e79778df980b12f1110b12445d` |
| `chat-journey-checks.ts` | `961785234157394b9893f49d89868a5ba735ec0b646b26ea558a9080126d5563` |
| `chat-ask-checks.ts` | `e89710ac7f6250874b0d843a56e70c35227cd56a624462ed24de59a12d80cdb0` |
| `chat-memory-checks.ts` | `75399d046679e0b4e61ec7066170c83bcd0da1ce10fe971c834e90d41ceab5b3` |
| `chat-page-callback-probe.ts` | `928da2a3d30188b77d896db2f36d243579f268d818b2fbd6a140e73d64fcf876` |

## Diagnoses, environment and remaining gaps

- a: unusable server (webpack/native instrumentation compilation; registry
  version-check blocked by Node hook), zero checks. Retained under
  `output/chat-ask-memory-20261002-a/`.
- b: 58/58 then-selected HTTP rows passed; finalizer misclassified deliberate
  shutdown. Receipt remains failed, not rewritten.
- c: 61 rows and cleanup passed; independent read-only review prompted explicit
  failed claim verdicts, same-group denial and missing-log retention control.
- d: combined execution after those evaluation changes, **no runtime fix**.
  Controls reject missing/malformed logs, malformed/truthy/duplicate checks,
  callback exceptions and missing retention; finalize/cleanup affect exit.
- Failed scratch retained: `/var/tmp/cortex-qa-tmp/chat-journey-96HH28` (a),
  `chat-journey-BIbZLs` (b). Known run-owned paths, never delete unrelated scratch
  by prefix. Successful c/d scratch removed.
- `/tmp` ~2 MiB free; actual root scratch ~39 GiB at start/~38 GiB at close;
  capacity/inodes checked. No Podman operation needed; shared-engine hazards and
  unknown-owner resources in restore receipt untouched, no new health claim.
- Node DNS/Socket tripwire: **zero blocked attempts in d**; a shows sensitivity.
  Not OS-level egress isolation; native/Rust sockets are not all observed. Every
  configured upstream is synthetic loopback.
- Browser, model quality, demo throttle, relay event-feed, OIDC/reset, concurrent
  streaming rebase, production runtime parity and online/mixed-version recovery
  remain unverified. Page obligations remain failed, browser not-run.
- K was not repeated. The historical `output/` path was absent at session start;
  K's receipt survives as aggregate, not a new raw-artifact retrieval claim.

Next: browser-reproduce the two races, then an explicitly scoped turn/session-aware
callback fix with positive persistence/regenerate gates. Retain this baseline.

Independent read-only closeout review checked D's receipts, source/input digests,
gate arithmetic, defect verdicts and repaired fresh-session index; no blocker
remains for the **scoped evaluation-improvement** claim. It did not rerun tests or
claim browser/runtime acceptance. Final source hashes still match D after the
documentation harvest.

Authorized runtime/UI follow-up completed after this frozen baseline:
[`2026-10-02-turn-bound-ui.md`](2026-10-02-turn-bound-ui.md), checkpoint
`chat-ui-turn-bound-20261002-b`. D was not replayed or rewritten; its defective
page and original verdicts survive independently. Current probes are positive
candidate gates with retained-baseline rejection controls.
