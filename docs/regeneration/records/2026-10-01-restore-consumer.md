# Record: restored-state consumer HTTP slice — 2026-10-01

Work package: the consumer half of the chat recovery gate — run the REAL Next
application against a copy of an actually restored fixture state and prove,
over real HTTP routes, that the restored state is consumable (login, restored
identity/messages/memory/asset bytes, key decryption/injection) and that the
negative controls fail at the actual routes. Files owned: the pre-existing
drafts `scripts/restore-consumer.mjs` + `tests/restore-consumer.test.ts`
(preserved, then corrected — see review round below) and this record. The
fixture CLI (`scripts/restore-fixture.mjs`), fixture tests, guides, root and
index are NOT touched; `src/` remains untouched (`git diff 40fe797 -- src/`
empty; no runtime/deps/schema changes, no commits).

- Repository: cortex-chat @ `40fe797…` with the prior slices uncommitted and
  preserved; baseline before this slice's edits: **78/78 tests** (71 prior +
  7 draft consumer gate tests), typecheck clean.
- Ownership split: main qa/restore agent owns the fixtures/harness and all
  invocation; backend-agent owns `qa/restore/backend-consumer.py` (integrated
  uvicorn + chat app side); this script owns the chat-side consumer journey.

## What changed (review round on the draft)

### 1. Real false-pass removed: the `--backend-url` path was reportOnly

The draft marked the proxy check `ok: true, reportOnly` for a supplied backend
even on 401/500 — a false pass. Now, when `--backend-url` is supplied, the
real-backend gate is REQUIRED, not advisory:

- `--backend-url` must be an **exact isolated loopback** http URL
  (`127.0.0.1` / `[::1]` / `localhost`); anything remote/non-loopback is
  rejected at usage time (exit 2, no fallback, no `.env` read — no live
  ambiguity). `upstream.mode` is exactly `"isolated-backend"`.
- `GET /api/proxy/api/collections` (cookie-authenticated) must return **200**
  listing the permitted collection **`fx-collection-0001`** with the
  off-scope **`col-crr-2` absent** (structural id extraction + string-level
  absence). This proves the restored encrypted read key
  (`fx-key-read-0001` → `fx-synthetic-backend-read-key-0001`) not only
  decrypts locally but is **accepted by the real backend** — not
  sink/advisory.
- `GET /api/proxy/api/documents/fx-source-0001/file` must return **200 with
  nonempty bytes exactly equal** to `--document-file` — the independent
  app/oracle **v2** fixture snapshot coordinated by main (the CLI refuses a
  missing/empty snapshot or one lacking the stable sid `fx-source-0001`).
  Exact source assertions, stable sid; **no search/model claim** is made or
  possible here.
- New `--backend-admin-key <synthetic-key>` (default
  `fx-synthetic-admin-key-0001`, sink mode) for boot config alignment: the
  backend runner registers the fixture key/collections/documents under the
  same key the chat app boots with. Recorded in the result as a sha256-16
  fingerprint with source labeling (synthetic, orchestrator-provided).
- Sink mode (no `--backend-url`) is unchanged and explicitly labeled:
  loopback sink records the injected `X-API-Key` (local decryption proof)
  and is a **narrower label that cannot satisfy the real integrated gate**.

### 2. Network tripwire in the actual Next processes

A tripwire (`network-tripwire.cjs`, generated into the disposable work dir)
is injected into every build/app node process via `NODE_OPTIONS=--require`
(propagates to build workers): `dns.lookup` and `net.Socket.prototype.connect`
are patched so **non-loopback connections/resolutions are blocked and
recorded** (JSONL log, with pid/ppid/host/reason). Loopback (the sink,
backend and app all bind 127.0.0.1) is allowed. After the run the log is
read; **any blocked attempt fails the gate** with the attempts recorded in
`result.networkTripwire`. This covers model/auth/telemetry/font egress from
the real app — nothing may phone out.

### 3. Isolation and write discipline (hardened)

- App processes now also get `HOME`/`TMPDIR` inside the work dir (the draft
  only did this for the build) — no shared tree, no shared temp paths with
  other writers.
- `node_modules` is **always copied** into the work copy with an explicit
  free-space budget: the draft's same-device symlink reuse was **verified
  broken** (Turbopack: "Symlink node_modules is invalid, it points out of the
  filesystem root" — build log evidence), so no shared/symlinked dependency
  reuse exists.
- Pre-boot gates unchanged and kept: sentinel (kind/version/key fingerprint,
  independently derived constants), synthetic `fx-*` IDs, quiesce (no
  WAL/SHM at the source), and the **real full verifier**
  (`restore-fixture.mjs verify`) as the oracle. Source-artifact integrity:
  full `sha256` of the state source before/after the run must be identical
  (the app only ever sees a copy; a canary-carrying or divergent source is
  refused before boot; `--gate-only` runs only these gates).
- Startup-write ledger kept with **explicit enumeration** (no blanket
  ignore/silent exception): superadmin insert, builtin-soul insert-if-missing,
  `defaultGroupProvisioned` adoption marker (existing group, no key mint),
  per-login session/login_events/usage_events rows, `lastLoginAt`/`last_seen`
  touches, one scratch private chat (healthy instance) — everything else must
  be row-identical on the copy.

### 4. Negative controls at the actual routes

- Byte-missing instance: fresh copy of the restored state with
  `fx-user-0001.png` removed *after* the pre-boot gate, then the real route
  asserts **avatar → 404** while branding bytes still serve verbatim and
  login still works — proving the actual route detects the missing bytes
  (a gate-only refusal alone could never establish that).
- Counterparts on the healthy journey: unauthenticated `/api/me/chats` → 401,
  wrong password → 401, unknown email → 401, foreign private chat
  read/delete → 404, anon avatar → 401, proxy allowlist bypass → 404. The
  byte-missing instance now also exercises wrong-password → 401 and anon
  avatar → 401.

## Follow-up round: app runtime selection + locked isolated install

- **`--app-node <absolute node binary>`** (default: `process.execPath`):
  selects the node binary used ONLY for the child `next build`/`next start`
  processes. The parent script and the fixture verifier keep the existing
  Node + native bindings (fixture seed/verify stay on the parent node
  unchanged). With `--gate-only` the path is merely validated (absolute +
  exists — no version probe, no install, no work dir). Non-absolute or
  nonexistent paths are rejected at usage time (exit 2).
- **Locked isolated install — always** (best reproducibility; no "cheap
  reuse" branch): the work copy's `appDir` receives the verbatim
  `package.json` + `package-lock.json` and `node <appNode> <npm-cli.js> ci
  --no-audit --no-fund` installs the exact committed graph there. The
  repository's node_modules is never reused for the app and never mutated
  (no root `npm ci`). The npm CLI is resolved from the chosen node's prefix
  first, then the parent's. Env is an allowlist (PATH with the app node
  binary first so lifecycle scripts bind to the app runtime's ABI, fresh
  HOME/TMPDIR) — **no inherited npm/auth tokens**. Bounded by
  `--install-timeout` (default 600 s); a failed, timed-out or space-starved
  install is a **failure receipt, never green**. Package/registry downloads
  are allowed; no model/LLM call is involved.
- **Receipts** (`inputs.appInstall`): node path + actual `--version`,
  npmCli, installMs/exitCode/timedOut, install + build log paths (existing
  logs are never overwritten — a non-empty `--work-dir` is refused),
  sha256 digests of the copied `package.json` + `package-lock.json`, actual
  installed versions (next/react/react-dom/@sentry/nextjs/better-sqlite3 —
  cited, not assumed), and a native-binding smoke (`require('better-sqlite3')`
  under the app node — runtime/ABI agreement). `inputs.sourceCopy.treeSha256`
  hashes the copied source tree to identify the exact compiled artifact;
  symlinks are never materialized into the app source copy (a symlink in
  `src/`/`public/` is a refusal).
- **Platform/libc limitation (explicit):** a host Node 20 binary is glibc
  (Debian bookworm); the isolated install fetches glibc prebuilt native
  bindings, which is NOT the `node:20-alpine` musl production artifact. A
  Node 20 glibc run (`--app-node <node20>`) remains untested locally — no
  Node 20 binary exists in this environment and none was installed; the
  build failure was since explained without it (corrected finding above).
- **Node/process identity, no stale ports:** every app entry records its
  node binary + version and pid; binds stay 127.0.0.1 on freshly allocated
  ephemeral ports.
- **Tripwire:** covers all loopback forms (`127.0.0.0/8`, `::1`,
  `::ffff:127.*`), keeps its JSONL log (created empty at tripwire write so
  `networkTripwire.clean` is meaningful; zero blocks + present log = clean),
  and any blocked attempt fails the gate. Passthrough/conflict rules:
  `--app-node` + `--gate-only` = path validation only; `--app-node` equal to
  the parent node is allowed (the locked install still runs — no reuse
  branch); `--work-dir` must be empty or nonexistent.

## Addendum (2026-10-01, citation-content correction)

The required id `proxy-isolated-backend-citation-file-exact` in this record is
**obsolete** (bad oracle — the chat proxy allowlist intentionally permits
`/documents/{id}/content`, not `/file`; failure history preserved). The
current contract lives in `2026-10-01-citation-content-correction.md`: new
required id `proxy-isolated-backend-citation-content-exact` (document id
derived from the restored citation metadata; chunk_index-sorted "\n\n" join
must equal the `--document-file` UTF-8 text), fixture pack v2, and the
authenticated `/file` 404 kept as a permission-boundary negative control.

## Invocation contract (for the backend-run hook / main orchestrator)

```
node scripts/restore-consumer.mjs --state-dir <restored-copy> \
    --app-node <absolute node binary, e.g. a Node 20 glibc build> \
    --backend-url http://127.0.0.1:<uvicorn-port> \
    --backend-admin-key <synthetic admin key from the backend runner> \
    --document-file <app/oracle v2 citation snapshot>
```

- Backend side (`qa/restore/backend-consumer.py`, backend-agent): register
  `fx-synthetic-backend-read-key-0001` with permitted collection
  `fx-collection-0001` and the off-scope decoy `col-crr-2`; serve
  `GET /api/documents/fx-source-0001/file` with the exact v2 snapshot bytes;
  boot under the same admin key passed to the chat app.
- Result JSON (single object on stdout; progress on stderr; exit 0 success /
  1 failure / 2 usage):
  - `cli.{script,node,repoRoot,flags}` — flags: `stateDir`,
    `appNode`/`appNodeIsDefault`, `backendUrl`,
    `backendAdminKey`/`backendAdminKeyDefault`, `documentFile`, `workDir`,
    timeout overrides (`installTimeoutMs`, build/startup/request),
    `keepWorkDir`, `gateOnly`.
  - `inputs.{gate:{refusals,realVerifier},stateSource,workDir,
    sourceCopy:{copied,treeSha256,fileCount},
    appNode:{path,version,parentNode,note},
    appInstall:{ok,node,npmCli,installMs,exitCode,timedOut,logPath,
    actualVersions,nativeBindingSmoke},
    backendAdminKey:{source,sha256_16,note},
    documentFile:{path,sha256,bytes}}`
  - `apps[]` — build/healthy/byte-missing instances: `node{path,version}`,
    `pid`, port, bootMs, ready, env label, ledger.
  - `checks[]` — `{id,route,method,ok,detail,note?}`; the two REQUIRED
    isolated-backend ids are exactly `proxy-isolated-backend-collections-200-scoped`
    and `proxy-isolated-backend-citation-file-exact` (no extra adapter
    requests to the backend exist that could hide bad statuses; both fail
    loudly on anything other than the asserted outcomes).
  - `exercisedRoutes[]`, `upstream{mode,url,requests?,keyObserved?,note}`,
    `networkTripwire{injected,log,scope,blockedAttempts,clean}`,
    `declaredWrites[]`, `limitations[]`, `cleanup{stateDirUnchanged,...}`,
    `failures[]`, `failedChecks?`, `timings`.
  - Canonical raw fields for the main receipt (stable): `upstream.url`,
    `networkTripwire.clean`, `cleanup.stateDirUnchanged`, and the two check
    ids above (`networkTripwire` is `null` only on early refusals that never
    reached the build phase).
- Failure behavior: exit 1 with `failures[]`/`failedChecks[]`; the work dir
  is kept for forensics with its path in `cleanup.workDir`.

## Verification evidence (exact commands and results)

| # | Command (cwd `/home/clippy/coding/cortex-chat`) | Result |
|---|---|---|
| 1 | Baseline `npm test` (drafts included, before edits) | **78/78 pass** (71 prior + 7 draft consumer gate tests) |
| 2 | `node --import tsx --conditions=react-server --test tests/restore-consumer.test.ts` (after edits) | **13/13 pass** (7 preserved draft refusals + 6 new: remote backend-url rejection, missing `--document-file`, empty/no-sid document rejection, gate-only with valid isolated-backend config, `--app-node` relative/nonexistent rejection, gate-only `--app-node` path-only validation) |
| 3 | `npm run typecheck` | **exit 0, 0 errors** |
| 4 | `npm test` (final tree) | **84/84 pass, 0 fail** (71 prior + 13 consumer) |
| 5 | `git diff --stat 40fe797 -- src/` | **empty** — no runtime edits |
| 6 | Full sink-mode journey: `seed` → `restore-consumer.mjs --state-dir <copy> --work-dir /var/tmp/rcons-full-smoke3` (default `--app-node` = Node v22.22.3) | **exit 0, ok:true — 24/24 checks pass**, `upstream.keyObserved: true` (restored group key injected at the loopback sink), `networkTripwire.clean: true` (0 blocked, log present), ledger clean (pre-boot baselines), `cleanup.stateDirUnchanged: true`, work dir removed; actual versions cited: next 16.1.7, react 19.2.4, react-dom 19.2.4, @sentry/nextjs 10.62.0, better-sqlite3 12.9.0; locked install ~17s; native binding smoke ok |
| 7 | Diagnostics (earlier round, retained): tripwire-disabled and Sentry-enabled builds | identical prerender failure — later attributed to the repo node_modules copy (see corrected finding); attempt result JSONs kept in `/tmp/opencode/rcons/` |
| 8 | ENOSPC probe | an install that runs out of space fails with `npm error TAR_ENTRY_ERROR ENOSPC` in the kept install log — a failure receipt, never green |

**Finding, corrected in the follow-up round (prior evidence retained):** the
first full attempts failed `next build` at prerendering `/_global-error` with
`InvariantError: Expected workUnitAsyncStorage to have a store` and the cause
was recorded as unknown (independent of tripwire and Sentry — both controls
were run). The follow-up round's locked isolated install identified the real
cause: the draft had **copied the repository's heterogeneous node_modules**
into the work copy. With dependencies installed from the committed
package.json + package-lock.json inside the work copy, the **same Node
v22.22.3 builds the unchanged app successfully and the full sink-mode journey
passes end to end** (24/24 checks). The earlier "run under Node 20"
presumption is therefore retracted as a fix hypothesis; `--app-node` remains
for explicit runtime selection and runtime/lockfile/ABI agreement. Retained
failure evidence (prior attempt result JSONs, never overwritten):
`/tmp/opencode/rcons/{sink-result.json,notrip-result.json,notrip2.json,sentry.json}`
and the build-log excerpts quoted below.

**Second real bug found by the first green-path attempt (fixed):** the
tripwire's DNS hook mishandled the `{all: true}` lookup callback shape
(`[[{address,family}]]` — a single argument), blocking the loopback literal
`127.0.0.1` and killing `next start`. Callback-shape normalization added;
proven by the subsequent fully green run with zero blocked attempts and a
present, empty tripwire log.

**Third real bug (fixed):** the ledger snapshots were taken after boot, so the
declared boot writes (superadmin insert, builtin souls, adoption marker) were
invisible and the healthy ledger false-failed (`users: 3 -> 3, expected +1`).
Baselines are now captured pre-boot on the copy; expected counts include the
+1 superadmin user and +3 builtin assistants.

## Honest limits

- **HTTP-route journeys only — NOT a browser journey**; no visual/UI claim.
- No search/model/LLM request is exercised anywhere; no model-quality or
  retrieval claim is possible from this gate (the citation check proves byte
  fidelity of a known fixture document through the generic document proxy
  route, nothing else).
- Sink mode remains a narrower label: decryption/injection proof only. The
  full sink-mode journey is now locally green (24/24 checks); the
  **isolated-backend required checks are implemented and unit-gated at the
  refusal level but their first real execution is main's integrated run**
  with the backend-agent's uvicorn consumer app.
- The startup-write ledger runs on the COPY with pre-boot baselines; the
  state source must remain byte-identical (enforced by pre/post hashing +
  the real verifier).
- CI runs only the light gate-only refusal suite; the full prod build +
  `next start` journey belongs to the main orchestrator with coherent frozen
  inputs. A Node 20 (`--app-node`) run remains untested locally (no Node 20
  binary present, none installed); the local Node 22 build failure was
  explained by the shared node_modules copy, not the Node version.
- The negative-control 404s prove route behavior on isolated derivative
  copies; they do not by themselves prove anything about the healthy
  instance's bytes (those are proven by the sha-equal 200 checks).

Next actionable step (main): run the consumer with `--app-node` (Node 20
glibc if available) against the backend-agent's uvicorn consumer app with the
coordinated v2 document snapshot; record the isolated-backend required checks
and tripwire result in the campaign receipt. If the Node 20 glibc run also
passes, the runtime-selection claim is established; it is not presumed.
