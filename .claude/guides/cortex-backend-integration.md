# Cortex backend integration — scoped guide

Owns: how this app talks to the Cortex backend — keys, proxies, upload, web import, analytics injection, resilience behaviors, collection scoping.
Related gates: `tests/upstream-retry.test.ts` (server-side retry matrix), `tests/streaming-contract.test.ts` (SSE client contract incl. 429/shutdown), `tests/api-fetch-retry.test.ts` (browser retry rules), `tests/proxy-strip-parity.test.ts` (identifier-stripping parity, structural), `tests/crypto-password.test.ts` (key envelope), `tests/rate-limit-message.test.ts`.

## API Keys — How we talk to Cortex

Behavioral ask-route gate: `scripts/chat-journey-checks.ts` drives **real Next
HTTP context** with fixture SQLite and controlled upstream; replay/results in
`docs/regeneration/records/2026-10-02-ask-memory-journey.md`. Both routes cover
auth, local-ID stripping, exact key/correlation/identity encoding, allowlist and
invisible context scope. `tests/chat-ask-oracle.test.ts` challenges forwarding
assertions. This is dev/HTTP evidence, not browser or real-backend-scope evidence.

Frontend never sees backend keys. All keys are stored **encrypted at rest** in SQLite (`api_keys.encrypted_value`, AES-256-GCM, key from `APP_ENCRYPTION_KEY`) and injected by server routes as the `X-API-Key` header.

| Key | Permission | Stored where | Used for |
|-----|------------|--------------|----------|
| `BACKEND_ADMIN_API_KEY` (env) | `admin` | env only | Superadmin operations: mint per-group/per-user keys via `POST /api/admin/keys`, list collections for the group editor |
| Group chat key | `read`, scoped to collections | `api_keys`, referenced by `groups.chat_key_id` | Every `/api/ask*` and `/api/search*` request from a user in that group |
| User content key | `manage`, scoped to collections | `api_keys`, referenced by `users.content_key_id` | `/api/me/upload` — only users granted a content role can upload documents |

**Collection scoping** — `api_keys.collection_ids` is a JSON array; `[]` means all collections (matches the Cortex backend convention). The backend automatically filters reads by the key's scope, so the chat dropdown will only show collections the user's group can access.

**The generic proxy is allowlisted**: only the specific backend endpoints the chat UI needs may be proxied under the group read-key (`/api/collections`, `/api/features`, `/api/tasks/{id}`, `/api/documents/{id}/content`, `POST /api/ask` in `src/app/api/proxy/[...path]/route.ts`). Add a rule when the UI needs a new endpoint — do not widen to a catch-all.

## Upload flow — "no extraction in UI"

`POST /api/upload` on the Cortex backend takes a `start_processing` query param that **defaults to `false`** (bulk-upload flow: park files as pending, process later via `POST /api/documents/process-pending`). Our `/api/me/upload` route passes `start_processing=true` explicitly so extraction kicks off in the background per file — without it, user uploads would sit pending until an admin runs process-pending. We honor the "never start extraction" UX requirement by **confirming upload as soon as the HTTP response lands** and **never surfacing extraction progress** in this UI. Extraction still runs asynchronously in Cortex; it's simply not this app's concern.

**Multi-file:** the backend accepts one file per multipart request, so `UploadTab` uploads a multi-selection sequentially (one request per file, per-file status list, batch summary toast). A 429 or 507 aborts the rest of the batch (marked "skipped"); other per-file errors (unsupported type, 409 duplicate) don't stop the batch. Re-submitting after a partial failure skips files already marked done. The `accept` list mirrors the backend's `allowed_extensions` (`backend/app/config.py` in cortex-app) — includes `.epub`.

## Web Import (MDHarvest / crawl4ai)

A second content-add path on the `/upload` surface, alongside file upload: paste URLs (or use **Discover links** to crawl a page for same-site links), pick a content filter (Readable / Full page / Relevance-ranked), and harvest the pages into a collection as markdown. UI is a feature-gated mode toggle inside `UploadTab` (`WebImportForm.tsx`); same content-role gating as upload.

- **Feature gate.** Backend exposes `GET /api/features` → `{enable_web_crawl}` (true only when `ENABLE_WEB_CRAWL` **and** a `CRAWL_SERVICE_URL` are set). `UploadTab` reads it via the generic proxy (`/api/proxy/api/features`) and hides the toggle when off, so the feature is invisible unless the backend is wired to a crawl4ai service.
- **Permission split.** Submit + discover are `MANAGE` actions → ride the **user content key** via dedicated routes (`/api/me/web-import`, `/api/me/web-import/discover`), with the same collection-scope enforcement as upload. Progress polling + the feature flag are `READ` → ride the **group chat key** through the generic proxy. (Content keys are minted `manage`-only and would 403 on the READ-gated `/api/tasks/{id}` and `/api/features`.)
- **Async, but progress IS shown.** Unlike file upload, Web Import is a backend task (`POST /api/web-import` → `{task_id}`); the UI polls `GET /api/proxy/api/tasks/{task_id}` (~1.5s) for a progress bar and a final "imported N of M" summary. This is crawl/import progress, not document extraction progress — the "no extraction in UI" rule still holds for the subsequent ingestion.
- **Task records survive backend restarts** — polling may return `failed` ("interrupted by server restart") instead of 404; `WebImportForm`'s poller handles `failed` — no 404 special-casing needed.
- Logged as a `usage_events` row with `kind: "upload"`, `metadata.source: "web-import"` (no schema change).

## Cortex chat analytics

Admin-editable context block injected into every backend request, server-side, for backend agent skills to read (e.g. forwarding chat summaries to a CRM with the user's identity attached).

- **Storage:** `app_settings` table, key `cortexAnalyticsTemplate`. Edited from `/admin/settings`. Empty default — no injection unless an admin opts in.
- **Variables:** declared in `CORTEX_ANALYTICS_VARIABLES` (`src/lib/settings.ts`). v1 = `$userEmail`, `$userName`. Adding a new variable means extending that constant and the substitution map in `renderCortexAnalytics` — the admin info-icon popover reads from the API response, so the UI hint stays in sync automatically.
- **Substitution:** `renderCortexAnalytics(template, user)` in `src/lib/cortex-analytics.ts`. `$userName` falls back to `email` when `username` is blank. Returns `null` for an empty template so the caller can skip injection cleanly.
- **Injection:** `injectCortexAnalytics(bodyText, rendered)` prepends `{role:"user", content: rendered}` to `conversation_history` before the `/api/ask/stream` proxy forwards upstream. Fails open on malformed JSON — never block a chat because of a bad admin template.
- **Invisibility:** the block never reaches the browser (proxy mutates the body server-side only) and is never written to `chat_messages`. Re-applied per request, so admin edits take effect immediately for in-flight sessions.
- **Truncation caveat:** the Cortex backend caps `conversation_history` (env `MAX_CONVERSATION_HISTORY=6`). Re-injecting at position 0 every turn keeps the block present in the *current* request — which is what skills see — even after older turns fall off.

## Backend resilience (v-next behaviors)

Adopted from the cortex-app v-next hand-off notes; all additive and backward-compatible.

- **429 + Retry-After.** Deployments with `RATE_LIMIT_QPM` return 429 with `Retry-After` on bursts (besides the monthly-quota 429). All proxy routes pass `Retry-After` through; the client never auto-retries a 429 — `apiFetch` throws `RateLimitError`, `askQuestionStream` calls `onRateLimited`, and the UI shows a localized message in chat and on upload. **Two 429 flavors** (backend 2026-07): the per-key burst limit (seconds-scale `Retry-After`) and the monthly unit quota `MAX_QUERIES_PER_MONTH` (Retry-After = seconds until the next UTC month). `rateLimitMessage()` (`src/lib/rate-limit-message.ts`) tells them apart by horizon (>6h ⇒ quota) and shows `quotaExhausted` with the reset date instead of a "wait N seconds" absurdity. Quota also gates processing endpoints (upload, reprocess, web-import, graph builds) — in-flight work always finishes; only *starting* work is blocked.
- **507 Insufficient Storage.** The backend's free-disk guardrail (`MIN_FREE_DISK_MB`, default 500) refuses uploads/reprocess/imports with 507 before disk-full can corrupt Neo4j. Upload UI and DocumentsTab show `serverStorageFull`.
- **413 body ceilings.** Backend middleware rejects oversized bodies (`MAX_REQUEST_BODY_MB` default 32 globally; `MAX_FILE_SIZE_MB` + slack on uploads). Our own client-side `MAX_UPLOAD_BYTES` check should stay ≤ the backend's upload cap so users get the friendly local message first.
- **Sanitized 5xx.** In production the backend returns generic 5xx bodies plus `request_id` — never parse specifics out of 5xx bodies; correlate via `X-Request-ID` in server logs.
- **Auth-store outage = 503, not 401 (backend 2026-07).** The backend no longer answers 401 when its key validation fails transiently (Neo4j restart/blip); those are 503 + `Retry-After`. A 401 through the proxy is therefore authoritative (revoked/deleted key or logged-out session) — never auto-retry it. Transient 5xx: browser `apiFetch` already retries GETs; the SSE route (`/api/ask/stream/route.ts`, `fetchUpstreamWithRetry`) retries 502/503/504 and connect failures server-side (2 retries, honors `Retry-After` capped at 3s) before any bytes stream, so brief backend restarts don't surface as chat errors.
- **Degraded / injection-flagged documents (2026-07).** `GET /api/documents` items carry `entity_count` (-1 = unknown), `unembedded_chunk_count`, `injection_flagged`, `injection_reason`. "Degraded" is derived client-side (completed + 0 entities or unembedded chunks) — DocumentsTab shows amber `degradedBadge`/`injectionFlaggedBadge` chips with the reason as tooltip. Reprocessing a degraded document bypasses the backend's "content unchanged" skip automatically.
- **Monthly usage & disk stats.** `GET /api/stats` now reports `monthly_usage_used/limit/query/processing` and `disk_free_mb`/`disk_total_mb`; ProcessingTab renders a usage meter (amber ≥80%, red when exhausted) and a disk-free KPI when present.
- **`event: shutdown` SSE frame.** On rolling restarts the backend ends active streams with `event: shutdown` instead of a dead socket. `askQuestionStream` transparently resubmits (max 2 reconnects, same `X-Request-ID`); `onReconnect` clears the partial assistant message so the regenerated answer streams clean.
  Actual consumer gate: `scripts/chat-shutdown-journey.ts <fresh-output> <fresh-id>
  http|browser` with owned root-backed TMPDIR; types in `scripts/tsconfig.chat-shutdown.json`.
  Raw shutdown after partial content, held content-free retries, exhaustion and exact
  HTTP/SQLite history/opaque memory are verified through Chromium, with settled/legacy
  and direct feedback/regenerate controls. Replay IDs remain stable; explicit new user
  actions get fresh IDs. Receipt: `docs/regeneration/records/2026-10-02-ask-shutdown.md`.
- **`X-Request-ID` correlation.** The client generates one id per user action (one per stream, stable across shutdown reconnects); every proxy route reuses-or-mints it, forwards it upstream, and echoes it on the response. The admin client (`src/lib/backend/index.ts`) mints one per call. Lines across chat → backend → cortex-helper share one id (`LOG_FORMAT=json` upstream).
- **Retry wrapper.** `apiFetch` retries 3 attempts with exponential backoff + jitter (0.5–4s): GETs on connect failure and 5xx; non-GETs only on fetch rejection (no response received — the browser approximation of connect-failure-before-send). Never on 429.
- **Collections cache.** `GET /api/collections` has no pagination upstream (verified); `fetchCollections` caches client-side for 60s with in-flight dedup.
- **Titles.** Chat titles come from the first user message (no LLM call) and are guarded once-per-session via `titleGeneratedRef` — nothing regenerates on reconnect/replay, so no tenant LLM budget is burned.
- **Keep `Accept-Encoding: identity`** on the SSE proxy. The v-next nginx config disables buffering on `/api/ask/stream`, which will make it redundant once deployed everywhere — but it stays harmless; don't remove it this cycle.
- **Answer-quality flags (backend 2026-09-03).** The `done` frame carries `refused: true` when the stream was the prompt-injection safe refusal (the refusal `content` frame carries it too) and `truncated: true` when the writer hit its output-token cap; the non-streaming `/api/ask` response has the same two fields plus `finish_reason`. `askQuestionStream` folds them into `onDone(flags)`, `page.tsx` stamps `refused`/`truncated` on the message (persisted in metadata like `feedback`, accepted by the chats PATCH schema), and `MessageBubble` shows a neutral notice under the answer. Older backends send no flag — `isRefusalText()` (`src/lib/answer-flags.ts`) matches the canned text as a fallback. **`refusal_source` (backend 2026-09-15+)** rides beside `refused` (`heuristic` = regex validator, `classifier` = prompt-guard model, `model` = the writer emitted the deflection itself) and is stamped as `refusalSource`; the notice then names the safeguard ("Prompt guard" mono label) and, for the classifier, says it may be a false positive — the guard sees only the bare question and is known to flag ordinary phrasings ("where are the docs deployed?"). Since that backend release the gates also run on the non-streaming `POST /api/ask`, so "Stream responses" off no longer bypasses them. The personality generator skips refused research answers via the same flag.
- **`session_id` never goes upstream.** Since backend 1.2.0 `session_id` is a real ask-request field (server-side sessions): a foreign id gets 403 (`ENABLE_SESSIONS` off) or 400 `session_conflict` (with client-carried history/memory). The chat uses the field for its own live-turn relay, so BOTH proxies strip `session_id`, `assistant_id`, `project_id` before forwarding — `/api/ask/stream/route.ts` and the generic `/api/proxy` for the non-streaming `POST /api/ask` (the path taken when "Stream responses" is off). Keep the two lists in sync (structural gate: `tests/proxy-strip-parity.test.ts`).
- **No-content documents (backend 2026-08-15).** `GET /api/documents` items may carry `content_status` (`empty` | `encrypted`) + `content_note` on a `completed` document (zero-byte / zero-page / password-protected source — chunkless, invisible to retrieval, terminal). DocumentsTab shows a grey "No content"/"Protected" chip beside the status with the note as tooltip and excludes these from the degraded heuristic (upstream leaves `entity_count` unset for them, but don't rely on that).

## Collection Scoping (user-facing)

- Chat and Deep Research default to searching **all collections the user has access to** (i.e. the scope of their group's chat key). No `collection_id` is sent — the backend filters by key scope.
- Streaming delegates collection authorization to that backend key; generic ask
  also rejects an explicitly off-scope collection locally. Distinguish the two
  effect boundaries in evaluations rather than adding a new permission rule.
- Project membership scopes **context injection**, not permission to ask generally.
  An inaccessible `project_id` adds no project instructions; `/api/ask/stream` still
  uses the authenticated caller's group key. The relay target is separately guarded
  by `canReadChatSession`. Chat reads/saves and new event-feed admission return404
  when a former non-author member no longer has a grant. An author retains their own
  chat access. Do not turn a synthetic stale project ID into a blanket ask403 gate.
  Executed sharing/consumer scope: `docs/regeneration/records/2026-10-02-project-sharing.md`.
- Users can narrow to a single collection via the settings panel (gear icon).
- The scope indicator in `ChatInput` shows the resolved collection name or "Searching across all collections".
