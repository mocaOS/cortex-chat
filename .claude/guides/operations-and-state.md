# Operations & state ownership — scoped guide

Owns: SQLite/WAL/files/encryption ownership, migrations, env validation, error tracking, deployment conventions.
Related gates: `tests/sqlite-contracts.test.ts` (migrations, FK actions, historical upgrade contracts, legacy-fixture negative control), `tests/crypto-password.test.ts` (AES-256-GCM envelope, argon2).

Recovery fixture: `scripts/restore-fixture.mjs seed|verify|mutate <directory>` uses
real migrations/crypto on **synthetic state only**, at the actual volume-root layout.
Its directory sentinel is a fixture marker, never the asset oracle. Verification
requires quiescence and leaves DB bytes/file set unchanged; existing live data is
not a valid input. `tests/restore-fixture.test.ts` exercises accepted/remapped copies
and missing assets/messages, wrong keys, forged sentinel and post-T controls.
The app's `qa/restore/RESULTS.md` records real sidecar restoration and the opt-in
restored-state HTTP consumer run (`scripts/restore-consumer.mjs`). Consumers run
on copies, prove original input unchanged, use sanitized env/egress tripwires and
must retain structured observations before cleanup. An exit/finalize failure is
never `ok: true`. Freeze coordination inputs during runs; version wrong-gate
corrections against actual supported routes. Heavy install scratch needs adequate
filesystem capacity. Locked packages on Node 22 do not prove Node 20/Alpine parity;
HTTP login/read does not establish browser or active-WAL snapshot behavior.

## Storage & state ownership

Ask/memory request-context evaluations use `scripts/chat-journey-runtime.mjs`
with real seed tooling, fresh synthetic SQLite, private verbatim copies of the
existing dependency graph and `next dev`; no installs/shared dependency writes.
Actual receipt retention must succeed before removal; missing/malformed logs or
check rows, failed finalize and unexpected pre-stop exits fail closed. Normal
owned shutdown is a separate phase. Node DNS/Socket hooks are tripwires, not
OS/native-socket egress isolation. Replay/limits:
`docs/regeneration/records/2026-10-02-ask-memory-journey.md`.

Actual UI evaluations reuse that runtime through `chat-browser-journey.ts`, using
existing Playwright/Chromium outside the package graph. Set root-backed `TMPDIR`
for the browser profile too; full `/tmp` can crash Chromium before checks.
Browser routing blocks external origins and dev HMR (lazy registry check); not
OS/native socket confinement. Required page-error, unhandled-rejection and
selection checks fail closed. PATCH capture is not acknowledgment: wait for
committed HTTP + SQLite state before durable assertions. Tooling/resources:
`docs/regeneration/records/2026-10-02-turn-bound-ui.md`.

Project lifecycle gates reuse this runtime (`chat-project-journey.ts`, separate
http/browser invocations); record: `docs/regeneration/records/2026-10-02-project-lifecycle.md`.
Two independent user contexts can share one owned Chromium process to reduce
resource pressure; every context's page errors/crashes still fail acceptance.
Establish EventSource connection before testing remote changes, collect actual
PATCH acknowledgments, and distinguish an assertion failure from an unreachable
UI selector or target crash. Keep failed attempts and corrected-gate rationale.

Project edit/read-order/reconnect follow-up uses `chat-project-followup-journey.ts`
and the same owned runtime. Its loopback forwarding barrier holds real response
traffic and destroys actual owned sockets; native offline emulation alone may
leave existing SSE connected. Flush forwarded headers for idle feed readiness.
Feedback checks must await their metadata commit even if pre-write memory/content
already match. Bound owned renderer processes/heaps when fresh-page observers
exceed capacity; record launcher/binary identity and all-context crash verdicts.
Receipt: `docs/regeneration/records/2026-10-02-project-followup.md`.

Held adoption/terminal navigation gates (`chat-project-selection-journey.ts`) retain
executed gate bytes and separately judge HTTP/browser. Same-exchange navigation
preserves the local immutable request snapshot after visible completion; loaded
history/recall still comes from storage. Record actual dev compilation delay versus
transport readiness failure, and preserve a missed readiness bound even if the
same connection later opens. Launcher changes and successful reruns do not prove
the cause of a prior target crash. Retain actual process diagnostics; browser
background services can bypass page-request routing, so clean application tripwires
do not prove process-wide egress confinement. Diagnosis/evidence:
`docs/regeneration/records/2026-10-02-project-selection.md`.

Terminal fallback evaluations: `chat-project-terminal-journey.ts` and
`docs/regeneration/records/2026-10-02-project-terminal.md`. The runtime's2GiB free
scratch preflight also gates prepare-only contract-suite controls: running the
suite below that floor causes setup/dependent failures, not product regressions.
Restore identified owned capacity; never lower the guard or reclaim unknown-owner
resources. Failed private dependency copies can be reclaimed only after receipt
retention and graph identity verification; preserve required diagnostics separately.
When losslessly re-retaining owned generated caches, verify archive payloads before
removal and retain the current retrieval mapping/digest. Preserve symlink targets
verbatim (`cpSync` defaults can absolutize relative links); compare file bytes and
link targets before trusting a copy. Archival process limits are separate from
product readiness bounds; neither timeout nor target crash is acceptance evidence.
The expanded-capacity terminal resume passes v1.4 Chromium/HTTP and the full suite;
earlier capacity/crash/adapter failures remain historical. Preserve operation-filtered
barriers: a transport adapter's request quota may include fallthrough operations.
Reserve the intended method/document before asynchronous fetch and retain raw request
order, captured bodies and actual acknowledgments. Driver corrections need fresh
frozen bytes and an integrated run, without changing the product's acceptance values.
Bound diagnostic re-retention against the actual capacity shortfall, including
temporary extraction/compression storage and memory. If safe owned recovery cannot
meet the unchanged floor, name the capacity prerequisite and keep independent work
moving. After provisioning, recheck measurements/inputs and rerun blocked stages;
the later pass does not diagnose the earlier crash or erase the failed receipt.
When a case leaves held work pending, distinguish dependent count/drain failures
from the primary rejection and stop or isolate it before another independent case.

Ask shutdown uses `chat-shutdown-journey.ts` and the same isolated fixture; receipt
`docs/regeneration/records/2026-10-02-ask-shutdown.md`. A retry's stable correlation ID
can recur in the fixture's ID-keyed pending map: release/remove the prior held response
before waiting for the next attempt, and record sequence numbers too. Flush actual
headers on content-free held retries so partial-reset observations precede new tokens.
External durable reads must remain observations; never inject them into the browser
being judged. Personal chats avoid project normal-send rebase masking. Check every
PATCH acknowledgment and exact HTTP/SQLite state; retain receipt/gate/phase screenshots
before removing successful scratch. Request correlation does not add storage dedup.

Project-sharing evaluations use `chat-project-sharing-journey.ts`; receipt
`docs/regeneration/records/2026-10-02-project-sharing.md`. Compare complete raw chat
rows and metadata before/after share-only transactions; scope intentional feedback/
continuation writes separately. Observe exact grant sets through owner HTTP and SQLite.
Retain actor identity on request/ack observations so peer adoption cannot be counted
as a repairing read by the writer. Fresh permission rejection does not revoke an
already-admitted feed: preserve that observed limitation in the evidence claim.

Move evaluation (`chat-project-move-journey.ts`, owning record `2026-10-02-project-move.md`)
holds a genuine successful PATCH response after its transaction, then navigates before
delivery. Storage success and current-view selection are separate; compare the full
origin rows and current consumer's request/context. Correlate browser/upstream ask IDs
and require an active held operation, not an already-released earlier record. A local
exact-route interceptor must retain the intercepted actual PATCH before fulfilling;
otherwise the generic passive recorder may miss it while the response acknowledgment
still arrives. Keep failed evaluator and product baselines separate and retrievable.

Project deletion (`chat-project-delete-journey.ts`, receipt `2026-10-03-project-delete.md`)
compares every raw project/share/session/message row: only the selected project and
its grants disappear; affected project IDs become NULL. Unrelated project rows,
all authors' chat state, metadata and timestamps must remain exact. Observe genuine
DELETE acknowledgment separately from its committed transaction and current view.
Request-event capture covers specifically intercepted requests without depending on
generic route fallthrough. Preserve the legacy FK negative control; fresh-schema
route success alone cannot prove legacy explicit-detach compatibility. Keep native
locale selector failures and their dependent contamination as evaluator failures.

Pre-dispatch rejection (`chat-project-delete-rejection-journey.ts`, receipt
`2026-10-03-project-delete-rejection.md`) uses `route.abort("failed")` on the actual
DELETE before fetch/continue. Require its browser `requestfailed`, no acknowledgment,
no matching server DELETE log and exact unchanged raw state. A successful real DELETE
in the same log is the diagnostic healthy control. This proves a known no-commit
failure; losing a response after dispatch/commit does not prove rollback. Keep
expected transport failures identified by method/resource; every other mutation
still needs its real acknowledgment. External reads observe state only; direct
edit/regenerate must consume page-held context and immutable memory without refetch.

Remote deletion (`chat-project-remote-delete-journey.ts`, receipt
`2026-10-03-project-remote-delete.md`) keeps the member author's selected view while
its valid late compaction saves detached history/recall. Author-only flat-list
membership is positive association evidence; project absence alone is insufficient.
Characterize authority per effect: admitted ask/relay and open feeds can continue,
while a non-author's new read/save/feed returns404. Require the actual late browser
PATCH404 and complete unchanged raw state; a visible answer is not durable completion.
Retain expected HTTP rejection separately from page/unhandled errors. The corrected
settled-event adapter accepts optional kind and binds author/time to the stored write;
failed original gate bytes and both source/SQLite/profile diagnostics remain intact.

Association-list evaluations (`chat-project-association-list-journey.ts`, receipt
`2026-10-03-project-association-list.md`) reserve GET sequence before fetch and retain
actual response bytes. Separate latest-request ownership from selected-view ownership:
a pre-navigation response can still be the latest list request. Preserve genuine
move acknowledgment/current-load evidence and exact raw association-only deltas.
Auxiliary notification writes must publish to the channel actually consumed by the
page; no captured response is a trigger-control substitute. Retain unsupported-trigger
failures and dependent drain/selection failures separately from context rejections.

DELETE response-loss (`chat-project-delete-response-loss-journey.ts`, receipt
`2026-10-03-project-delete-response-loss.md`) retains the real route.fetch200 and
exact committed detach before aborting browser delivery. Observe browser requestfailed,
no acknowledgment, server-log200 and page list reconciliation separately. Require
one DELETE attempt/resource, valid late saves and direct no-GET consumers. Identified
expected transport failures do not exempt page/unhandled/unknown write failures;
retain network-console diagnostics and distinguish caller uncertainty from known state.

Move overlap (`chat-project-move-overlap-journey.ts`, receipt `2026-10-03-project-move-overlap.md`)
holds actual200 after commit A, then native B commits/acks before A's older ack.
Keep raw association-only state, commit/response/delivery clocks and both accepted outcomes.
Selected context derives from positive authoritative list membership under existing
request/view guards; no new gesture-order/CAS rule or repairing chat GET. Native drags
leave the drawer open: close it before message hover/actions, preserving overlay failures
separately from value rejections. Slice uses delegated evaluator and read-only review;
record exact scope/owned paths and reconcile the lead's combined candidate.

Reverse move (`chat-project-move-reverse-journey.ts`, receipt `2026-10-03-project-move-reverse.md`)
holds A before forwarding, proves unchanged full state/no response/no move ack, then
observes B200 in the same log channel before releasing A to commit/ack last. Bind
no-ack predicates to chat and move body, not earlier history saves. Failed teardown
may release a held mutation: later scratch DB state cannot replace pre-abort samples.
Retain both gate versions/failed diagnostics; mode-correct drain and errors still gate.

Runtime state lives under `./data/`:

- `data/cortex-chat.db` — SQLite DB (users, groups, api_keys, sessions, login_events, registrations, password_reset_tokens, chat_sessions [incl. opaque `memory` blob, `pinned`, `assistant_id`, `project_id`], chat_messages [incl. per-message `user_id` authorship], assistants, projects, project_shares, usage_events, app_settings) plus Drizzle's `__drizzle_migrations` ledger.
- `data/cortex-chat.db-wal` — SQLite WAL. **Contains committed state not yet checkpointed — part of the database, never disposable.** A backup/restore that copies only the `.db` file can lose committed writes. Stop all writers while capturing/restoring the consistent file set, or use a verified SQLite-consistent snapshot procedure. A checkpoint alone does not prevent later WAL writes or make a live tar atomic; include avatars/branding and retain the encryption key separately.
- `data/avatars/<userId>.{png,jpg,webp,gif}` — user profile images; the uploaded format is preserved (no automatic conversion). (Corrected 2026-10: previously described as WebP-only.)
- `data/branding/logo.<ext>` — admin logo; `data/branding/logo.email.png` is a derived, regenerable cache for email embedding.
- `data/` is gitignored. Docker mounts the **named volume** `cortex-chat-data:/app/data` (docker-compose.yml) — not a host bind mount. (Corrected 2026-10.)

Known gaps (recorded, not fixed): file writes/deletes and their DB pointer updates are separate operations, not one transaction; admin user deletion does not clean up the deleted user's avatar file.

- Schema lives in `src/lib/db/schema.ts`; migrations in `src/lib/db/migrations/` (generated via `npm run db:generate`, applied on server start via `src/instrumentation.ts` and manually via `npm run db:migrate`).
- The connection (`src/lib/db/client.ts`) sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` and nothing else — `synchronous`, busy timeout, and checkpointing are library defaults. Changing `DATABASE_PATH` after the module has opened does not switch databases.
- **Drizzle's migrator applies migrations by timestamp watermark only** — it never compares stored hashes, so editing an already-applied migration file does NOT retrofit existing deployments. Fix-forward with a new migration instead.
- **Never rely on FK actions for the ALTER-added columns** (`chat_sessions.assistant_id/project_id`, `chat_messages.user_id`): older deployments may have emitted ALTERs without `ON DELETE SET NULL`. Delete handlers for projects/souls detach explicitly in the same transaction. Proven/kept honest by the legacy-fixture negative control in `tests/sqlite-contracts.test.ts`.

## Env, boot validation & config conventions

- **Anonymize everything customer-facing in the repo.** Commits, changelogs, docs, code comments, tests, and fixtures never name a tenant, customer, client, instance hostname, or deployment (no company names, no `*.cortex.eco` tenant domains, no API keys or IDs from a real instance). Describe the trigger generically ("a deployment running the default model", "a thinking-by-default model") — the technical cause is the record, not who hit it. Debugging against a live tenant is fine; what lands in git is scrubbed.
- Hex color values must be quoted in `.env` files (e.g. `"#ff9500"`) because `#` is treated as a comment by dotenv.
- `NEXT_PUBLIC_` vars are compile-time inlined by Next.js — runtime config uses `/api/config` endpoint instead. **Server-side config (`CORTEX_API_URL`, `BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, `SUPERADMIN_*`) must never be prefixed with `NEXT_PUBLIC_`** — it stays on the server. The browser never calls the Cortex backend directly; all backend traffic goes through `/api/proxy/*`, `/api/ask/stream`, or `/api/me/upload`, which inject the right minted `X-API-Key` from SQLite. Deprecated aliases `NEXT_PUBLIC_API_URL` and `LIBRARY_API_URL` are mirrored onto `CORTEX_API_URL` at boot in `src/instrumentation.ts` with a console warning.
- Required env (`BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`) is validated at boot in `src/instrumentation.ts`. Missing or malformed values cause startup to throw a single aggregated error — do not paper over this with optional-chaining downstream.
- Route handlers validate input with `zod`; admin routes gate with `requireSuperadmin()`; user-self routes gate with `requireAuth()`; anonymous routes (`/api/auth/login`, `/api/config`) are in the middleware's `PUBLIC_PATHS` allowlist.
- Passwords hashed with `argon2id` (`hashPassword`/`verifyPassword` in `src/lib/auth/password.ts`, m=19456/t=2/p=1). Never log or return password hashes.
- Backend API keys are encrypted with `encryptSecret` before being inserted; decrypt on use with `decryptSecret` (`src/lib/auth/crypto.ts`, AES-256-GCM, envelope = base64(12-byte IV | ciphertext | 16-byte tag), key = `APP_ENCRYPTION_KEY` base64-decoded, must be exactly 32 bytes, no key-version/rotation mechanism). Never expose a decrypted key to the client. Losing `APP_ENCRYPTION_KEY` loses every stored backend key.

## Error tracking (GlitchTip)

Self-hosted GlitchTip (Sentry protocol) — org `cortex`, project `cortex-chat` (every CORTEX app has its own project there). SDK is `@sentry/nextjs`; **errors only** — `tracesSampleRate: 0`, and never add Replay/Profiling integrations (GlitchTip has no such products).

- **Init per runtime:** `src/instrumentation-client.ts` (browser), `src/sentry.server.config.ts` / `src/sentry.edge.config.ts` (imported from `register()` in `src/instrumentation.ts` before env validation, so boot failures are captured). `onRequestError` reports route/RSC errors; `src/app/global-error.tsx` catches client render crashes. Shared DSN/enabled/environment logic lives in `src/lib/glitchtip.ts` — the default DSN is baked in (submit-only identifier, safe in the bundle); overrides: `SENTRY_DSN` (server, runtime) / `NEXT_PUBLIC_SENTRY_DSN` (build time); `SENTRY_ENVIRONMENT` tags the deployment; `SENTRY_DISABLED=1` opts out; reporting is production-builds-only.
- **User context** is attached server-side in `getAuth()` (request-isolated scope — covers every authed route) and client-side after `/api/auth/me` resolves in `page.tsx`.
- **Source maps** are uploaded by `scripts/glitchtip-sourcemaps.mjs`, chained after `next build` (token-gated: no `SENTRY_AUTH_TOKEN` → build succeeds, upload skipped, `.map` files still stripped from `.next/static`). The plugin's own upload is disabled in `next.config.ts` for one ordering reason: browsers only report debug IDs when the **served** client chunks contain the `_sentryDebugIds` snippet, so `sentry-cli sourcemaps inject` must run **before** upload — the script does inject + upload (`--rewrite` embeds `sourcesContent` into Turbopack's server maps so GlitchTip shows source context). The Node runtime needs no snippet (the SDK reads Turbopack's `//# debugId` comments from disk) — and `.next/server` JS is never modified post-build, which would desync the already-assembled standalone output. Uploads are artifact bundles (GlitchTip ≥ 4.2), checksum-deduplicated — same-commit rebuilds are safe.
- **Releases:** `next.config.ts` derives `cortex-chat-<shortsha>` (`SENTRY_RELEASE` > Coolify's `SOURCE_COMMIT` > local git > package version) and injects it into bundles; the script recomputes the same value — keep both in sync. Names are sanitized to `[-a-zA-Z0-9_]` for consistency (required by GlitchTip < 6, harmless on 6.x).
- **Coolify:** set `SENTRY_AUTH_TOKEN` as a build-arg env var (compose maps it; Dockerfile keeps it out of the runtime image). `SOURCE_COMMIT` is provided by Coolify automatically.
- **Verify after deploy:** superadmin-only `GET /api/admin/debug-sentry` throws deliberately — the event must appear in GlitchTip with readable `src/...` frames and source context.
