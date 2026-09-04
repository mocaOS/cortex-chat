# CLAUDE.md

## Project Overview

Cortex Chat — a Next.js 16 multi-tenant chat suite for the Cortex RAG-based AI knowledge assistant (upstream codename: `library-backend`).

**Key features:**
- Email/password auth backed by server-side sessions (SQLite)
- Superadmin-provisioned users and user groups
- Per-group read-only API keys (chat); per-user manage keys (document upload / "content roles")
- Streaming SSE responses from backend (`/api/ask/stream`), with structured `status` stage events driving the live thinking indicator
- Conversation memory — client-carried, server-persisted opaque blob for cross-turn recall, citation continuity (`sid`), and a memory-only fast-path
- Deep Research (default) and Chat modes, admin-overridable default
- **Personalities** — assistant personas as portable SOUL.md files (builtin/global/group/personal tiers), injected server-side per turn; import/export with EIP-191 verification; a **generator** that researches the knowledge base and writes the SOUL.md via the backend's primary model
- **Projects** — shared team workspaces (group/user grants) with **multi-user chats** (per-message authorship, member writes) and **realtime** (live-turn relay + sidebar freshness over SSE, in-process bus)
- **Voice** — env-gated STT dictation + TTS read-aloud against any OpenAI-compatible audio API
- Message actions (copy / regenerate / edit-and-resend / 👍👎 feedback), sidebar search/pin/export, admin starter prompts
- Chat deep links (`/?chat=<id>`) with back/forward history
- Collection-scoped search (default: all collections the user's group can read)
- Source citations with modal viewer; graph context (entities/relationships), thinking steps
- i18n (EN/DE), locale set via config
- Server-side chat history, synced across devices per user; titles derived from the first user message
- Configurable accent color, logo, locale via `/api/config` endpoint
- Admin-defined `<cortexchatanalytics>` context block, injected server-side into every backend request for consumption by agent skills
- Login history + usage analytics (incl. answer-feedback KPI) for the superadmin
- **SSO (OIDC)** — vendor-agnostic Single Sign-On via OpenID Connect discovery, env-gated; JIT provisioning, verified-email account linking, optional `OIDC_ONLY` mode

## Auth & Users

- **Superadmin** is bootstrapped from env (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`). On every server start the row is upserted with a fresh `argon2id` hash — rotating the password means editing env and restarting.
- **Default group** — on the first boot of a fresh database, a "Full Access" group (read key over all collections) is auto-created and the superadmin is assigned to it, so chat works without a manual trip through `/admin/groups` (`src/lib/default-group-bootstrap.ts`). Runs in the background with spaced retries that never give up (backoff ladder, then a steady 5-min cadence — the Cortex backend may take arbitrarily long to come up); additionally self-heals on demand: `GET /api/auth/me` calls `ensureDefaultGroup()` when a group-less superadmin loads the app, so the first page load after the backend is reachable provisions the group inline (bounded at 8s). Guarded by the `defaultGroupProvisioned` marker in `app_settings` plus an in-transaction re-check, so it happens at most once per DB — deployments that already have groups are adopted as-is, and deleting the group later won't resurrect it on restart.
- **Users** are created by the superadmin (email + initial password). Each user belongs to exactly one `group`. Users can update their username, avatar, and password.
- **Sessions** are DB-backed (`sessions` table) with an opaque cookie token. 30-day sliding TTL. Middleware checks cookie presence; route handlers validate against DB via `getAuth()` / `requireAuth()` / `requireSuperadmin()` in `src/lib/auth/session.ts`.

## Password reset & email

Self-service and admin-triggered password reset, backed by the app's SMTP email
module (`src/lib/email/`). Entirely feature-gated: unset `SMTP_HOST` ⇒ no mail
sends, and both the login "Forgot password?" link and the admin "Send reset
email" button are hidden (`ClientConfig.emailConfigured`).

- **Config (env only):** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER?`, `SMTP_PASS?`,
  `SMTP_SECURE?`, `SMTP_FROM`, and `APP_BASE_URL`. When `SMTP_HOST` is set,
  `SMTP_FROM` + `APP_BASE_URL` are required (validated at boot in
  `src/instrumentation.ts`). Reset links use `APP_BASE_URL` only — never the
  request Host header.
- **Local dev (Mailpit):** SMTP is on `1025` (`8025` is Mailpit's web UI). Use
  `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `APP_BASE_URL=http://localhost:3000`.
- **Tokens:** `password_reset_tokens` table; `sha256(token)` at rest, plaintext
  only in the link; 60-min TTL; 60s resend cooldown; single-use. A successful
  reset updates the hash and deletes ALL of that user's sessions (atomic).
- **Enumeration-safe:** `POST /api/auth/forgot-password` always returns 200.
- **Superadmin excluded:** its password is env-managed (`SUPERADMIN_PASSWORD`,
  re-hashed every boot). Self-service issues no token for it; the admin route
  rejects it with 400.
- **Emails reuse DB branding:** accent (converted oklch→hex for mail clients),
  logo (inline CID), and app title from `app_settings`. PNG/JPEG logos embed
  as-is; SVG/WebP are converted to a cached PNG derivative
  (`data/branding/logo.email.png`, via `sharp`) — eagerly on upload, lazily on
  first send for pre-existing logos; only a failed conversion falls back to
  the text wordmark (`readEmailLogo` in `src/lib/branding.ts`). Email copy is
  server-side only (`src/lib/email/templates/`), never in `i18n.ts`.

## Single Sign-On (OIDC)

Vendor-agnostic SSO: one adapter over OpenID Connect **discovery**
(`{issuer}/.well-known/openid-configuration`) covers Entra ID, ADFS 2016+,
Okta, Auth0, Google Workspace, Keycloak, Authentik, Zitadel, … — no per-vendor
code. Legacy LDAP/SAML-only stacks bridge with a thin IdP (Authentik/Dex) in
front; that's documented practice, not built here. SSO is a **second way to
mint a `sessions` row** — the hand-rolled DB session model stays authoritative
(deliberately `openid-client`, NOT NextAuth). Feature-gated like SMTP/voice:
unset `OIDC_ISSUER_URL` ⇒ no button, `/api/auth/oidc/*` 404.

- **Env (all in `src/lib/auth/oidc.ts`, boot-validated in
  `instrumentation.ts`):** `OIDC_ISSUER_URL` (presence enables; https:// or
  localhost-http only), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and
  `APP_BASE_URL` (redirect URI = `{APP_BASE_URL}/api/auth/oidc/callback`) —
  all four required together. Optional: `OIDC_SCOPES` (default
  `openid profile email`), `OIDC_BUTTON_LABEL` (default: localized "Single
  Sign-On"), `OIDC_DEFAULT_GROUP` (group NAME for JIT users, resolved at login
  time; unset ⇒ group-less, chat blocked until an admin assigns),
  `OIDC_ONLY`.
- **Flow:** Authorization Code + PKCE (`src/lib/auth/oidc-flow.ts`). Issuer
  metadata cached in-process 15 min. PKCE verifier + `state` + `nonce` ride a
  10-min httpOnly cookie (`oidc_txn`, path-scoped to `/api/auth/oidc`), HMAC-
  signed with an `APP_ENCRYPTION_KEY`-derived key; deleted on every callback
  outcome (single-use — replayed callback URLs fail). The callback rebuilds
  the current URL from the configured redirect URI + actual query string so
  reverse proxies can't desync the token-exchange `redirect_uri`.
- **Account resolution (callback, strict order):** (1) `(oidc_issuer,
  oidc_sub)` match → login; (2) email match → link ONLY when
  `email_verified === true` (account-takeover guard — never link on an
  unverified claim); (3) superadmin email/role → **reject**
  (`error=oidc_superadmin`) — the env-managed break-glass account never
  depends on the IdP; (4) JIT-create with `password_hash = ""` (unusable
  sentinel; `verifyPassword` fails closed on malformed digests). The unique
  index covers the `(issuer, sub)` pair; issuer stored is the *discovered*
  canonical issuer, not the env string.
- **Pre-hijack containment:** JIT deliberately does NOT require
  `email_verified` (Entra ID never emits the claim — requiring it would break
  the flagship IdP), so on an IdP that lets users pick unverified emails an
  attacker could squat a not-yet-provisioned address. Two mitigations: the
  email-match **link path evicts every existing session** for the account in
  the same transaction (reset-password pattern), so a squatter is fully
  logged out the moment the verified owner first signs in; and re-linking a
  row that already carries a different `sub` logs a server-side warning
  instead of happening silently. Operator guidance: keep email verification
  ON at IdPs with self-service signup.
- **`OIDC_ONLY=true`:** password form hidden, `/api/auth/login` 403s everyone
  except the superadmin email, `isRegistrationEnabled()` forced false.
  Superadmin escape hatch: `/login?password=1` shows the password form again.
- **Errors:** every failure redirects to `/login?error=oidc[_unverified|_superadmin]`
  with localized generic copy — IdP error bodies/tokens never reach the
  browser (voice-proxy sanitization rule). Post-login redirect is always `/`.
- **Observability:** `login_events.method` (`password`/`oidc`, migration
  `0010`) tags every attempt incl. rejected links; usage_events login rows
  carry `metadata.method: "oidc"`.
- **Out of v1 (documented, deliberate):** claim→group/admin mapping, RP-
  initiated logout, refresh tokens (no IdP calls after login, no tokens
  persisted), multiple simultaneous IdPs, SCIM — disabling a user at the IdP
  does NOT kill existing 30-day chat sessions; delete the user in /admin.
- **Dev IdP:** `docs/dev/keycloak/` — compose file + realm import with test
  users (verified/unverified email) preconfigured for
  `http://localhost:3000`.

## Self-registration & admin approval

Public `/register` page (email + password + confirm with a live match
indicator) writing to a separate `registrations` table — deliberately NOT a
status column on `users`, so every `users` row stays a real, sign-in-capable
account and no existing query needs a "pending" filter. Feature-gated by
`ENABLE_REGISTRATION` (**default ON**; set `false`/`0` to disable — the login
"Create account" link disappears, `/register` redirects, and
`POST /api/auth/register` 404s, while the admin tab keeps working for leftover
pending rows).

- **Approval:** Registrations tab on `/admin/users` (`requireAdmin`). Confirm
  opens a group-picker modal (the group carries chat access); approval is one
  transaction (insert `users` row with role `user` + delete registration) in
  `POST /api/admin/registrations/[id]/approve`, which re-checks the email
  against `users` (409 if an admin created it meanwhile).
- **Approval email** (`templates/account-approved.ts`, EN/DE like
  password-reset) is best-effort AFTER commit — a failed send never rolls back
  an approval; the response's `emailSent: false` makes the UI warn. No SMTP ⇒
  silently skipped.
- **Pending login:** `/api/auth/login` answers 401 + `code: "pendingApproval"`
  only when the password verifies against the pending hash — wrong passwords
  get the generic 401, so outsiders can't probe emails. Signup dupes get an
  honest 409 (deliberate contrast to the strictly enumeration-safe
  forgot-password flow).
- **Spam floor:** in-memory 60s per-IP cooldown on `/api/auth/register`
  (skipped when no client IP is attributable; resets on restart).
- **Password fields** app-wide (login, register, reset, profile, admin user
  form) use the shared eye-toggle components (`src/components/PasswordInput`
  public flavor, `PasswordInput` in `components/admin/ui` labeled flavor).

## Demo mode

Env-gated public demo (`DEMO_MODE=true`) that flips an existing deployment
into a "try the product" instance without touching other accounts. One shared
demo user + browser-local chat storage — no ephemeral guests, no schema change.

- **Env (`src/lib/demo.ts`, boot-validated in `instrumentation.ts`):**
  `DEMO_MODE` (presence enables), `DEMO_EMAIL` (default `test@test.com`),
  `DEMO_PASSWORD` (default `test`), `DEMO_GROUP` (group NAME deciding the
  demo's collection scope; unset = keep current, else first group). Refuses to
  boot with `OIDC_ONLY` or when `DEMO_EMAIL == SUPERADMIN_EMAIL`.
- **Bootstrap (`src/lib/auth/demo-bootstrap.ts`, after `bootstrapSuperadmin`):**
  upsert by email, `role:"user"`, `contentKeyId:null` (upload fails closed),
  password re-hashed every boot (published creds self-heal). Never repurposes
  an existing non-`user` row. Group join retries in the background on fresh
  installs (default group may still be provisioning). `app_settings.demoUserId`
  marker; flipping `DEMO_MODE` off disarms the account on next boot (password
  → `""` unusable sentinel, sessions evicted).
- **Identification is email-match** (`isDemoUser`) — no schema change. Flag
  surfaces as `demo: true` on `/api/auth/me` and `ClientConfig.demo`
  (`{enabled, email, password}` — published creds, exposing them is the
  point; kept in sync across `/api/config`, the layout seed, and the offline
  fallback like every config flag).
- **Login:** form prefilled from config + `demoNotice` banner; one click.
- **Chats live in localStorage** for the demo user only:
  `src/lib/chatHistory.ts` is a dispatcher (`setChatStorageMode`, set
  UNCONDITIONALLY in page.tsx after `/api/auth/me` — login/logout are
  client-side navigations, a stale "local" must never leak into a real
  session). `src/lib/demoChatStore.ts` mirrors the API semantics exactly
  (pinned 0/1, `pinned desc, updatedAt desc`, pin/move don't bump updatedAt,
  `getChat → null`, `memory === undefined` never clobbers). Keys
  `cortexDemo.v1.*`, 30-chat cap with oldest-unpinned eviction, quota
  evict-and-retry, in-memory Map fallback when localStorage is unavailable.
  Works because `/api/ask/stream` needs a user + group key but NO server chat
  row, and memory replay is fully client-carried. Deep links, pin, export,
  search, regenerate/edit all work unchanged; the events SSE feed and the
  feedback POST are skipped client-side.
- **Lockdown (`forbidDemo` in `src/lib/auth/demo-guard.ts`, 403):** password,
  profile (username feeds the analytics block upstream), avatar, personal
  souls CRUD + `souls/generate` (cost sink), projects CRUD/shares, directory
  (email enumeration — the one GET blocked), chats mutations (belt-and-braces;
  GETs stay open), and forgot-password silently skips the demo email (reset
  hijack). Upload/web-import/admin already fail closed via key/role.
- **Throttle:** `/api/ask/stream` sliding window per visitor IP for the demo
  user only (5/min, 429 + `Retry-After`, register-cooldown pattern) — the
  backend can't tell visitors apart (it sees one proxy IP); its
  `RATE_LIMIT_QPM`/monthly quota stay the aggregate backstop.
- **UI for demo:** profile link → storage note in the sidebar footer,
  project "+" and souls manage hidden (curated builtin/global souls still
  show), `/profile` bounces to `/`.
- Trade-offs (accepted): sessions/login_events accumulate one row per
  visitor on the shared account; admin "top users" collapses demo traffic
  into one row.

## API Keys — How we talk to Cortex

Frontend never sees backend keys. All keys are stored **encrypted at rest** in SQLite (`api_keys.encrypted_value`, AES-256-GCM, key from `APP_ENCRYPTION_KEY`) and injected by server routes as the `X-API-Key` header.

Three kinds of key in play:

| Key | Permission | Stored where | Used for |
|-----|------------|--------------|----------|
| `BACKEND_ADMIN_API_KEY` (env) | `admin` | env only | Superadmin operations: mint per-group/per-user keys via `POST /api/admin/keys`, list collections for the group editor |
| Group chat key | `read`, scoped to collections | `api_keys`, referenced by `groups.chat_key_id` | Every `/api/ask*` and `/api/search*` request from a user in that group |
| User content key | `manage`, scoped to collections | `api_keys`, referenced by `users.content_key_id` | `/api/me/upload` — only users granted a content role can upload documents |

**Collection scoping** — `api_keys.collection_ids` is a JSON array; `[]` means all collections (matches the Cortex backend convention). The backend automatically filters reads by the key's scope, so the chat dropdown will only show collections the user's group can access.

## Upload flow — "no extraction in UI"

`POST /api/upload` on the Cortex backend takes a `start_processing` query param that **defaults to `false`** (bulk-upload flow: park files as pending, process later via `POST /api/documents/process-pending`). Our `/api/me/upload` route passes `start_processing=true` explicitly so extraction kicks off in the background per file — without it, user uploads would sit pending until an admin runs process-pending. We honor the "never start extraction" UX requirement by **confirming upload as soon as the HTTP response lands** and **never surfacing extraction progress** in this UI. Extraction still runs asynchronously in Cortex; it's simply not this app's concern.

**Multi-file:** the backend accepts one file per multipart request, so `UploadTab` uploads a multi-selection sequentially (one request per file, per-file status list, batch summary toast). A 429 or 507 aborts the rest of the batch (marked "skipped"); other per-file errors (unsupported type, 409 duplicate) don't stop the batch. Re-submitting after a partial failure skips files already marked done. The `accept` list mirrors the backend's `allowed_extensions` (`backend/app/config.py` in cortex-app) — includes `.epub`.

## Web Import (MDHarvest / crawl4ai)

A second content-add path on the `/upload` surface, alongside file upload: paste URLs (or use **Discover links** to crawl a page for same-site links), pick a content filter (Readable / Full page / Relevance-ranked), and harvest the pages into a collection as markdown. UI is a feature-gated mode toggle inside `UploadTab` (`WebImportForm.tsx`); same content-role gating as upload.

- **Feature gate.** Backend exposes `GET /api/features` → `{enable_web_crawl}` (true only when `ENABLE_WEB_CRAWL` **and** a `CRAWL_SERVICE_URL` are set). `UploadTab` reads it via the generic proxy (`/api/proxy/api/features`) and hides the toggle when off, so the feature is invisible unless the backend is wired to a crawl4ai service.
- **Permission split.** Submit + discover are `MANAGE` actions → ride the **user content key** via dedicated routes (`/api/me/web-import`, `/api/me/web-import/discover`), with the same collection-scope enforcement as upload. Progress polling + the feature flag are `READ` → ride the **group chat key** through the generic proxy. (Content keys are minted `manage`-only and would 403 on the READ-gated `/api/tasks/{id}` and `/api/features`.)
- **Async, but progress IS shown.** Unlike file upload, Web Import is a backend task (`POST /api/web-import` → `{task_id}`); the UI polls `GET /api/proxy/api/tasks/{task_id}` (~1.5s) for a progress bar and a final "imported N of M" summary. This is crawl/import progress, not document extraction progress — the "no extraction in UI" rule still holds for the subsequent ingestion.
- Logged as a `usage_events` row with `kind: "upload"`, `metadata.source: "web-import"` (no schema change).

## Cortex chat analytics

Admin-editable context block injected into every backend request, server-side, for backend agent skills to read (e.g. forwarding chat summaries to a CRM with the user's identity attached).

- **Storage:** `app_settings` table, key `cortexAnalyticsTemplate`. Edited from `/admin/settings`. Empty default — no injection unless an admin opts in.
- **Variables:** declared in `CORTEX_ANALYTICS_VARIABLES` (`src/lib/settings.ts`). v1 = `$userEmail`, `$userName`. Adding a new variable means extending that constant and the substitution map in `renderCortexAnalytics` — the admin info-icon popover reads from the API response, so the UI hint stays in sync automatically.
- **Substitution:** `renderCortexAnalytics(template, user)` in `src/lib/cortex-analytics.ts`. `$userName` falls back to `email` when `username` is blank. Returns `null` for an empty template so the caller can skip injection cleanly.
- **Injection:** `injectCortexAnalytics(bodyText, rendered)` prepends `{role:"user", content: rendered}` to `conversation_history` before the `/api/ask/stream` proxy forwards upstream. Fails open on malformed JSON — never block a chat because of a bad admin template.
- **Invisibility:** the block never reaches the browser (proxy mutates the body server-side only) and is never written to `chat_messages`. Re-applied per request, so admin edits take effect immediately for in-flight sessions.
- **Truncation caveat:** the Cortex backend caps `conversation_history` (env `MAX_CONVERSATION_HISTORY=6`). Re-injecting at position 0 every turn keeps the block present in the *current* request — which is what skills see — even after older turns fall off.

## Conversation memory & streaming status

Both consume additive, backward-compatible features on `/api/ask/stream`. Parsing lives in `askQuestionStream` (`src/lib/api.ts`); orchestration in `src/app/page.tsx`.

- **Memory round-trip.** The client sends an **opaque** `conversation_memory` blob each turn (`{}` on turn 1), reads the updated blob from the `memory_update` SSE event, and replays it next turn. Never construct or mutate it — store and replay verbatim. Held in `memoryRef` (no stale closure / no re-render), persisted with messages.
- **Event order (backend v2, `EMIT_DONE_BEFORE_MEMORY`).** `done` now arrives **before** `memory_update` (the done frame carries `pending_memory: true`) so the UI finalizes as soon as the last token lands; the blob follows 1-4s later (post-answer compaction) and then the stream closes. Two invariants in code: the `askQuestionStream` read loop (`src/lib/api.ts`) must keep consuming past `done` until the stream actually ends, and `onMemoryUpdate` (`src/app/page.tsx`) re-persists the session when the blob lands after `done` (`doneSeen` flag) — otherwise the server-side session keeps the previous turn's memory and a reload/device-switch loses that turn's recall. The legacy order (memory_update → done) still works for older backends.
- **Persistence.** Stored per session in `chat_sessions.memory` (nullable JSON TEXT, migration `0002`). PATCH `/api/me/chats/[id]` folds it into the messages transaction so a settled turn is atomic; GET returns it; loaded on session select, reset on new/delete. Survives reload and device-switch like chat history.
- **Citation continuity.** Each `sources[]` item now carries a conversation-stable `sid`. It rides inside the sources array, so it persists in message metadata and reloads automatically — no separate map, no rendering change.
- **Status events.** `status` `{stage, message}` drives the `ThinkingIndicator` label directly (`message.status.message`), falling back to the old field-presence heuristic when absent. The memory fast-path (no `searching`/`sources`) is handled by this automatically.
- **Heartbeats.** `: ping` comment lines need no handling — the parser only acts on `data:` lines.

## Chat UX pack

Hover-revealed message actions, sidebar organization, starter prompts, and chat deep links. All client-side except the feedback event and the pin flag.

- **Deep links**: the active chat rides as `/?chat=<id>` — selection pushes history (back/forward walk conversations, `popstate` handler), first-send session creation replaces in place, new-chat/delete return to `/`, and the URL chat is restored on load (membership-checked by the API; unknown ids clean the URL). All via `history.pushState`/`replaceState` in `page.tsx` (`syncUrl`), no route change.

- **Message actions** (`MessageBubble`, hidden while streaming, always visible on touch): copy; **regenerate** (offered only on the thread's final assistant message); **edit-and-resend** (user messages — forks the thread, everything after the edited message is dropped); 👍/👎 feedback.
- **Regenerate vs. the opaque memory blob.** The blob can't be rewound, so `page.tsx` keeps a one-turn snapshot (`memoryAtSendRef`) of the blob *as it was when the last question was sent*. Regenerate — and editing the **last** question — restores the snapshot so the redo doesn't "remember" the answer it replaces; editing an earlier message resets memory to `{}` (recall restarts at the fork). After a session load the snapshot is the stored blob itself — best available, slightly degraded. Regenerate/edit rebuild the thread via `handleSend(question, baseOverride)` — the override is the truncated prefix, avoiding a race with the `messages` state update.
- **Feedback** stamps `feedback: "up"|"down"` into the message (persisted in message metadata, so the thumb survives reload) and best-effort POSTs `/api/me/feedback`, which writes a `usage_events` row (kind `feedback`, metadata `{sessionId, messageId, rating}`) after verifying chat ownership. Admin dashboard shows a "+ / −" KPI (`json_extract` on the metadata).
- **Sidebar**: client-side title search; pin/unpin (`chat_sessions.pinned`, migration `0005`) — pinned chats form their own group above the time groups, and toggling pinned deliberately does **not** bump `updatedAt`; per-chat Markdown export (`src/lib/exportChat.ts` — transcript + numbered source footnotes per answer).
- **Starter prompts**: admin-curated questions (`app_settings.starterPrompts`, newline-separated, max 4 — `parseStarterPrompts` is the single parser shared by `/api/config`, the layout seed, and the admin validator) rendered as cards on the empty chat screen; a click submits the question.

## Souls (assistant personas)

**Naming:** the user-facing term is **Personality** (DE: Persönlichkeit); **SOUL.md** is the technical file-format term (kept in labels like "SOUL.md content", "Export SOUL.md"). Code identifiers stay `assistants`/`soul*`.

A soul IS a **SOUL.md file** — portable persona documents (soulweaver/OpenClaw convention) stored verbatim in `assistants.soul` and injected server-side per turn. Frontmatter (`name`, `description`, `starters:` dash-list, `collection`) is parsed at save time (`mode:` is retired/ignored — the global default chat mode always applies) by `parseSoulFile` (`src/lib/souls.ts` — hand-rolled, no YAML dep) and cached in columns; the **body** (file minus frontmatter) is the injected persona.

- **Three tiers (`assistants.scope`): `builtin` (repo-shipped in `src/lib/builtin-souls.ts` — embedded strings, not files, so the standalone build needs no fs reads; seeded by `builtinKey` in `instrumentation.ts`: insert-if-missing, and builtins removed from the repo list are DELETED with explicit reference detach — admin "remove" = `enabled=0` still sticks across restarts), `global` / `group` (admin-curated at `/admin/assistants`, `requireAdmin`), `user` (personal, max 20, managed from the chat empty screen's souls modal)). All tiers are **editable after creation** (`PATCH` with `{content}` — users their own via `/api/me/assistants/[id]`, admins any tier incl. builtins via `/api/admin/assistants/[id]`); the SOUL.md is replaced verbatim and the cached frontmatter columns (name/description/starters/collection) re-derive, so adjusting the starter questions = editing the `starters:` list. Shared edit UI: `SoulEditModal` (pencil on own souls in the user modal, Edit button on the admin page). Running chats pick edits up on their next turn.
- **Injection:** the client sends `assistant_id` on every `/api/ask/stream` turn (persisted on `chat_sessions.assistant_id`, migration `0006`, so the choice survives reload). The proxy scope-checks it (`getUsableAssistant`), strips the field, and prepends the soul body to `conversation_history` via the same mechanism as the analytics block — order `[analytics, soul, …turns]`, re-applied per request, never persisted, never echoed to the browser.
- **Picker UX:** pill chips on the empty chat screen ("Cortex" default + visible souls + a "+" manage button); the active soul's `starters` replace the global starter cards, its `collection` frontmatter is applied as an advisory default on selection; ongoing chats show a soul chip in the composer. Soul is fixed per chat at creation.
- **Import & verification:** paste / upload / URL. URL import (`src/lib/soul-import.ts`, server-side fetch with private-host guard + size cap) understands soulweaver's public souls API and verifies the **EIP-191 signature** (viem): keccak256(content) must equal `contentHash`, the signing message (`{hash}|{chainId}:{contract}:{tokenId}|codex-vN`) must embed it, and `recoverMessageAddress` must yield the claimed signer → `verifiedSigner` badge. Failed verification downgrades to unverified import, never blocks. Any other URL is treated as raw SOUL.md. **Export** (`downloadSoul`) round-trips the verbatim file — portability is the point.
- **Soul Builder ("Generate" tab)** — soulweaver's architecture, for a hard reason: sending the author meta-prompt as a Cortex query trips the backend's **prompt-injection defense** (instant canned deflection). So `POST /api/me/souls/generate` orchestrates two phases: (1) **research through Cortex with benign queries** — hybrid `/api/search` + plain `/api/ask` questions (`buildResearchQuestions`), deflections filtered by `isUsableAnswer` (soulweaver's refusal detection), every step streamed as a `thinking` frame into the UI's live research log; (2) **writing via the Cortex backend's own primary model** through its admin-gated `POST /api/llm/completions` (rides `CORTEX_API_URL` + `BACKEND_ADMIN_API_KEY`, zero extra config, temp 0.85, unit-metered + Langfuse-traced like every other completion; requires cortex-app ≥ the completions-endpoint release — older backends get a clear 404 message). There is deliberately NO separate LLM config for this — one model stack for the whole product (`buildWriterMessages`/`buildRevisionMessages` in `src/lib/soul-author-prompt.ts`). Revisions skip research and go straight to an editor prompt.  No chat persistence, no memory, no analytics/soul injection on itself. Client: `generateSoulStream` (`src/lib/assistants-client.ts`) strips `[src_N]` markers; shared composer `src/components/souls/SoulComposer.tsx`.
- Usage events tag soul turns (`metadata.assistantId`) and builder runs (`path: /api/me/souls/generate`).

## Projects (shared team workspaces)

A project groups chats and carries defaults inherited by chats created inside it: optional soul, collection scope, and **instructions** — an invisible per-turn context block. Tables: `projects` + `project_shares` (one row per grant: either `group_id` or `user_id`) + `chat_sessions.project_id` (migration `0007`).

- **Sharing:** owner-only, via one modal — a single search field over groups AND people (`GET /api/me/directory`, min 2 chars, 8 hits/kind) → chips → `PUT /api/me/projects/[id]/shares` replaces the set. Owner is implicitly a member.
- **Collaboration semantics — multi-user by default:** members see ALL chats in a project and **any member can continue any thread**. Authorship is per-message (`chat_messages.user_id`, migration `0008`): server-stamped for new message ids, **preserved by id across full-message replaces** (never trusted from the client — the schema accepts echoed `authorId`/`authorName` but drops them). Chat administration (title, pin, project move, delete) stays author-only. UI: teammates' names above their user messages; edit-and-resend only on own messages; regenerate only when the last exchange is own. `POST /api/me/chats/[id]/duplicate` still exists as a fork primitive (no UI entry point currently).
- **Realtime:** in-process pub/sub (`src/lib/chat-events.ts`, channel-keyed — `chat:`, `project:`, `user:`, `group:` — stashed on `globalThis` for dev HMR; single-container deployment model — multi-replica would need a shared bus).
  - **Open-chat feed** (`GET /api/me/chats/[id]/events`, membership-checked, 25s heartbeats): settled writes publish `changed`; the **live-turn relay** tees the `/api/ask/stream` answer (client sends `session_id`, membership-checked, project chats only) into `turn_start` (question + asker name) → `token` frames → `turn_done` — watchers render the teammate's question and watch the answer stream, then refetch the settled attributed state.
  - **User feed** (`GET /api/me/events`): multiplexes the user's `user:`/`group:` channels + every accessible project channel (membership snapshot at connect; the client reopens the feed when its project set changes). Publishers: chat create/delete/move, settled project-chat writes, share changes, project edit/delete. Client debounces into `refreshSessions()`.
  - Two members streaming into the SAME chat simultaneously still last-writer-wins for that turn — the send path re-fetches and rebases onto the server's messages+memory first (`handleSend` fresh-merge) to keep the window small.
- **Injection:** the client sends `project_id` per `/api/ask/stream` turn; the proxy membership-checks it and injects the project's instructions via the analytics-block mechanism — final order `[analytics, soul, project instructions, …turns]`, stripped upstream, never persisted.
- **Sidebar:** collapsible project folders above the flat list (which now shows only non-project chats — `GET /api/me/chats` filters `project_id IS NULL`); new-chat-in-project inherits the project's soul + collection client-side. **Drag & drop**: own chats drag between the flat list and project folders (`PATCH /api/me/chats/[id]` with `projectId`, membership-checked; organizational like pinning — no `updatedAt` bump).
- **Deletion keeps chats** — they fall back to their authors' flat lists. Detaching is done **explicitly in the delete handlers** (projects and souls both): SQLite `ALTER TABLE` FK columns on older deployments may lack the `ON DELETE SET NULL` action (drizzle-kit emitted the ALTERs without it originally; the migration files are fixed, but never rely on the FK action for these columns).

## Voice (STT dictation + TTS read-aloud)

Env-only, feature-gated like SMTP: unset `VOICE_*_BASE_URL` ⇒ the mic and read-aloud buttons don't exist (`ClientConfig.voice` flags). Both pairs point at **any OpenAI-compatible audio API** — a LAN LiteLLM router aggregating speaches (faster-whisper / Kokoro / Voxtral), Venice (`https://api.venice.ai/api/v1`), or OpenAI. Endpoints appended to the base: `/audio/transcriptions` (multipart) and `/audio/speech`.

- **Env:** `VOICE_STT_BASE_URL/API_KEY/MODEL` and `VOICE_TTS_BASE_URL/API_KEY/MODEL/VOICE` (`src/lib/voice.ts`). Keys optional (LAN routers may be keyless). Boot-validated: a set base URL requires its model. Note some TTS backends require `voice` (Kokoro: `af_heart`; `voxtral-tts`: `casual_female`) — the proxy omits the field when unset.
- **Proxies** (`/api/voice/transcribe`, `/api/voice/speech`): `requireAuth()`, provider key injected server-side, provider error bodies sanitized (never leaked — may echo config), 25MB audio cap, TTS input truncated to 4k chars (hearing the start beats an error).
- **UI:** mic in `ChatInput` (MediaRecorder webm/opus → transcribe → appended to the input, dictation-style; pulsing stop-square while recording); read-aloud in the message action row (`ReadAloudButton` — fetch once, blob-URL cached per message, toggle to stop). `stripForSpeech` (`src/lib/voice-client.ts`) reduces markdown to speakable text (code blocks, `[src_N]` markers, links, tables stripped).
- **Permissions-Policy caveat:** the baseline security headers in `next.config.ts` must keep `microphone=(self)` — with `microphone=()` every browser silently refuses `getUserMedia` for the whole document (no prompt, `NotAllowedError`), regardless of user permission. Mic also requires a secure origin (HTTPS or localhost); `ChatInput` checks `window.isSecureContext` and surfaces distinct errors for insecure origin / blocked / no device.
- Sentence-streaming TTS and hands-free call mode are explicitly later phases.

## Error tracking (GlitchTip)

Self-hosted GlitchTip (Sentry protocol) at `https://glitchtip.cortex.eco` — org `cortex`, project `cortex-chat` (every CORTEX app has its own project there). SDK is `@sentry/nextjs`; **errors only** — `tracesSampleRate: 0`, and never add Replay/Profiling integrations (GlitchTip has no such products).

- **Init per runtime:** `src/instrumentation-client.ts` (browser), `src/sentry.server.config.ts` / `src/sentry.edge.config.ts` (imported from `register()` in `src/instrumentation.ts` before env validation, so boot failures are captured). `onRequestError` reports route/RSC errors; `src/app/global-error.tsx` catches client render crashes. Shared DSN/enabled/environment logic lives in `src/lib/glitchtip.ts` — the default DSN is baked in (submit-only identifier, safe in the bundle); overrides: `SENTRY_DSN` (server, runtime) / `NEXT_PUBLIC_SENTRY_DSN` (build time); `SENTRY_ENVIRONMENT` tags the deployment; `SENTRY_DISABLED=1` opts out; reporting is production-builds-only.
- **User context** is attached server-side in `getAuth()` (request-isolated scope — covers every authed route) and client-side after `/api/auth/me` resolves in `page.tsx`.
- **Source maps** are uploaded by `scripts/glitchtip-sourcemaps.mjs`, chained after `next build` (token-gated: no `SENTRY_AUTH_TOKEN` → build succeeds, upload skipped, `.map` files still stripped from `.next/static`). The plugin's own upload is disabled in `next.config.ts` for one ordering reason: browsers only report debug IDs when the **served** client chunks contain the `_sentryDebugIds` snippet, so `sentry-cli sourcemaps inject` must run **before** upload — the script does inject + upload (`--rewrite` embeds `sourcesContent` into Turbopack's server maps so GlitchTip shows source context). The Node runtime needs no snippet (the SDK reads Turbopack's `//# debugId` comments from disk) — and `.next/server` JS is never modified post-build, which would desync the already-assembled standalone output. Uploads are artifact bundles (GlitchTip ≥ 4.2), checksum-deduplicated — same-commit rebuilds are safe.
- **Releases:** `next.config.ts` derives `cortex-chat-<shortsha>` (`SENTRY_RELEASE` > Coolify's `SOURCE_COMMIT` > local git > package version) and injects it into bundles; the script recomputes the same value — keep both in sync. Names are sanitized to `[-a-zA-Z0-9_]` for consistency (required by GlitchTip < 6, harmless on 6.x).
- **Coolify:** set `SENTRY_AUTH_TOKEN` as a build-arg env var (compose maps it; Dockerfile keeps it out of the runtime image). `SOURCE_COMMIT` is provided by Coolify automatically.
- **Verify after deploy:** superadmin-only `GET /api/admin/debug-sentry` throws deliberately — the event must appear in GlitchTip with readable `src/...` frames and source context.

## Backend resilience (v-next behaviors)

Adopted from the cortex-app v-next hand-off notes; all additive and backward-compatible.

- **429 + Retry-After.** Deployments with `RATE_LIMIT_QPM` return 429 with `Retry-After` on bursts (besides the monthly-quota 429). All proxy routes pass `Retry-After` through; the client never auto-retries a 429 — `apiFetch` throws `RateLimitError`, `askQuestionStream` calls `onRateLimited`, and the UI shows a localized message in chat and on upload. **Two 429 flavors** (backend 2026-07): the per-key burst limit (seconds-scale `Retry-After`) and the monthly unit quota `MAX_QUERIES_PER_MONTH` (Retry-After = seconds until the next UTC month). `rateLimitMessage()` (`src/lib/rate-limit-message.ts`) tells them apart by horizon (>6h ⇒ quota) and shows `quotaExhausted` with the reset date instead of a "wait N seconds" absurdity. Quota also gates processing endpoints (upload, reprocess, web-import, graph builds) — in-flight work always finishes; only *starting* work is blocked.
- **507 Insufficient Storage.** The backend's free-disk guardrail (`MIN_FREE_DISK_MB`, default 500) refuses uploads/reprocess/imports with 507 before disk-full can corrupt Neo4j. Upload UI and DocumentsTab show `serverStorageFull`.
- **413 body ceilings.** Backend middleware rejects oversized bodies (`MAX_REQUEST_BODY_MB` default 32 globally; `MAX_FILE_SIZE_MB` + slack on uploads). Our own client-side `MAX_UPLOAD_BYTES` check should stay ≤ the backend's upload cap so users get the friendly local message first.
- **Sanitized 5xx.** In production the backend returns generic 5xx bodies plus `request_id` — never parse specifics out of 5xx bodies; correlate via `X-Request-ID` in server logs.
- **Auth-store outage = 503, not 401 (backend 2026-07).** The backend no longer answers 401 when its key validation fails transiently (Neo4j restart/blip); those are 503 + `Retry-After`. A 401 through the proxy is therefore authoritative (revoked/deleted key or logged-out session) — never auto-retry it. Transient 5xx: browser `apiFetch` already retries GETs; the SSE route (`/api/ask/stream/route.ts`, `fetchUpstreamWithRetry`) retries 502/503/504 and connect failures server-side (2 retries, honors `Retry-After` capped at 3s) before any bytes stream, so brief backend restarts don't surface as chat errors.
- **Degraded / injection-flagged documents (2026-07).** `GET /api/documents` items carry `entity_count` (-1 = unknown), `unembedded_chunk_count`, `injection_flagged`, `injection_reason`. "Degraded" is derived client-side (completed + 0 entities or unembedded chunks) — DocumentsTab shows amber `degradedBadge`/`injectionFlaggedBadge` chips with the reason as tooltip. Reprocessing a degraded document bypasses the backend's "content unchanged" skip automatically.
- **Monthly usage & disk stats.** `GET /api/stats` now reports `monthly_usage_used/limit/query/processing` and `disk_free_mb`/`disk_total_mb`; ProcessingTab renders a usage meter (amber ≥80%, red when exhausted) and a disk-free KPI when present.
- **Task records survive restarts.** Backend tasks are persisted to Neo4j; after a redeploy, polling `GET /api/tasks/{id}` returns status `failed` ("interrupted by server restart") instead of 404. `WebImportForm`'s poller already handles `failed` — no 404 special-casing needed.
- **`event: shutdown` SSE frame.** On rolling restarts the backend ends active streams with `event: shutdown` instead of a dead socket. `askQuestionStream` transparently resubmits (max 2 reconnects, same `X-Request-ID`); `onReconnect` clears the partial assistant message so the regenerated answer streams clean.
- **`X-Request-ID` correlation.** The client generates one id per user action (one per stream, stable across shutdown reconnects); every proxy route reuses-or-mints it, forwards it upstream, and echoes it on the response. The admin client (`src/lib/backend/index.ts`) mints one per call. Lines across chat → backend → cortex-helper share one id (`LOG_FORMAT=json` upstream).
- **Retry wrapper.** `apiFetch` retries 3 attempts with exponential backoff + jitter (0.5–4s): GETs on connect failure and 5xx; non-GETs only on fetch rejection (no response received — the browser approximation of connect-failure-before-send). Never on 429.
- **Collections cache.** `GET /api/collections` has no pagination upstream (verified); `fetchCollections` caches client-side for 60s with in-flight dedup.
- **Titles.** Chat titles come from the first user message (no LLM call) and are guarded once-per-session via `titleGeneratedRef` — nothing regenerates on reconnect/replay, so no tenant LLM budget is burned.
- **Keep `Accept-Encoding: identity`** on the SSE proxy. The v-next nginx config disables buffering on `/api/ask/stream`, which will make it redundant once deployed everywhere — but it stays harmless; don't remove it this cycle.
- **Answer-quality flags (backend 2026-09-03).** The `done` frame carries `refused: true` when the stream was the prompt-injection safe refusal (the refusal `content` frame carries it too) and `truncated: true` when the writer hit its output-token cap; the non-streaming `/api/ask` response has the same two fields plus `finish_reason`. `askQuestionStream` folds them into `onDone(flags)`, `page.tsx` stamps `refused`/`truncated` on the message (persisted in metadata like `feedback`, accepted by the chats PATCH schema), and `MessageBubble` shows a neutral notice under the answer. Older backends send no flag — `isRefusalText()` (`src/lib/answer-flags.ts`) matches the canned text as a fallback. The personality generator skips refused research answers via the same flag.
- **`session_id` never goes upstream.** Since backend 1.2.0 `session_id` is a real ask-request field (server-side sessions): a foreign id gets 403 (`ENABLE_SESSIONS` off) or 400 `session_conflict` (with client-carried history/memory). The chat uses the field for its own live-turn relay, so BOTH proxies strip `session_id`, `assistant_id`, `project_id` before forwarding — `/api/ask/stream/route.ts` and the generic `/api/proxy` for the non-streaming `POST /api/ask` (the path taken when "Stream responses" is off). Keep the two lists in sync.
- **No-content documents (backend 2026-08-15).** `GET /api/documents` items may carry `content_status` (`empty` | `encrypted`) + `content_note` on a `completed` document (zero-byte / zero-page / password-protected source — chunkless, invisible to retrieval, terminal). DocumentsTab shows a grey "No content"/"Protected" chip beside the status with the note as tooltip and excludes these from the degraded heuristic (upstream leaves `entity_count` unset for them, but don't rely on that).

## Collection Scoping (user-facing)

- Chat and Deep Research default to searching **all collections the user has access to** (i.e. the scope of their group's chat key). No `collection_id` is sent — the backend filters by key scope.
- Users can narrow to a single collection via the settings panel (gear icon).
- The scope indicator in `ChatInput` shows the resolved collection name or "Searching across all collections".

## Tech Stack

- Next.js 16.1.7 (Turbopack, `output: "standalone"`)
- React 19.2.4, TypeScript 5.9.3
- Tailwind CSS 4.2.1, react-markdown 10.1.0 + remark-gfm
- SQLite + `better-sqlite3` + Drizzle ORM
- `@node-rs/argon2` for password hashing, `zod` for route validation
- Recharts for admin analytics
- Dark-first design system — see **Design system** below. Canonical OKLCh tokens live in `src/app/globals.css`; the legacy hex var names (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--text-primary`, `--text-secondary`, `--accent`) are kept as aliases over the MOCA tokens.

Use CSS variables for all colors. No light mode. Styling is inline Tailwind + CSS vars.

## Design system

This product uses the **MOCA Library design system** (aka Claude Design). Before building or restyling any UI, read `.claude/skills/moca-library-design/README.md` — the canonical manifesto (visual foundations, voice, motion, iconography). `.claude/skills/moca-library-design/design-system.html` opens a live specimen index of every component. The skill is user-invocable as `/moca-library-design`.

**Non-negotiables:**

- Use MOCA tokens from `src/app/globals.css`. Never invent a new color. The palette is monochrome OKLCh + **one** chromatic accent.
- **One accent per screen.** Accent = primary CTA, active nav, live/running state, citation badges. Not for hover backgrounds, generic highlights, or decoration. The accent is DB-backed in `app_settings.accentColor`, editable at `/admin/settings`; default is `oklch(0.79 0.18 70.67)` (warm yellow-green) defined as `DEFAULT_ACCENT_COLOR` in `src/lib/settings.ts`.
- **Dark mode is primary.** `class="dark"` is set on `<html>` in `layout.tsx`. Test features in dark first.
- **Glass on chrome, not data.** Apply `backdrop-filter: blur(24px)` + translucent bg to sidebars, top nav, composer, modal shells. Content cards use opaque `var(--card)` with a 1px `var(--border)` hairline. Glass-on-glass is forbidden.
- **Type.** Inter Variable for UI, JetBrains Mono for IDs / metadata / timestamps / status chips. Display ≥24px uses `-0.015em` to `-0.02em` tracking; small uppercase labels use `+0.08em` tracking at `font-size: 10.5–11px`.
- **Icons.** Lucide outline only, 1.5–2px stroke, `currentColor`. Size ladder 14/16/20/24px. No emoji in product UI. No Unicode-as-icon — `<ArrowRight />`, not `→`, in icon slots (`→` is fine inline in prose).
- **Radius ladder.** `--radius` (8px) cards/buttons/inputs, `--radius-sm` (4px) inline chips, `--radius-xl` (16px) modals, full-pill for filter chips.
- **Motion.** Entrance 300–400ms `ease-out`; micro-interactions 150–200ms; `active:scale-[0.98]` on primary buttons only. Hover shifts color/border, never position.
- **Voice.** Sentence case, no hype, precise numbers. AI answers open with "Based on *<source>*, …" and every answer shows source chips.

**When building new UI**, lift patterns from `.claude/skills/moca-library-design/preview/*.html` (23 component specimens) or `.claude/skills/moca-library-design/ui_kits/library/*.jsx` (Shell, ManageScreen, ExploreScreen, AskScreen). Match the visual output — you don't need to copy the prototype's internal structure.

## Storage

- Runtime state lives under `./data/`:
  - `data/cortex-chat.db` — SQLite DB (users, groups, api_keys, sessions, login_events, registrations, password_reset_tokens, chat_sessions [incl. opaque `memory` blob, `pinned`, `assistant_id`, `project_id`], chat_messages [incl. per-message `user_id` authorship], assistants, projects, project_shares, usage_events, app_settings)
  - `data/avatars/<userId>.webp` — user profile images
- `data/` is gitignored and intended to be bind-mounted in Docker (see `docker-compose.yml`).
- Schema lives in `src/lib/db/schema.ts`; migrations in `src/lib/db/migrations/` (generated via `npm run db:generate`, applied on server start via `src/instrumentation.ts` and manually via `npm run db:migrate`).

## Conventions

- Hex color values must be quoted in `.env` files (e.g. `"#ff9500"`) because `#` is treated as a comment by dotenv
- `NEXT_PUBLIC_` vars are compile-time inlined by Next.js — runtime config uses `/api/config` endpoint instead. **Server-side config (`CORTEX_API_URL`, `BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, `SUPERADMIN_*`) must never be prefixed with `NEXT_PUBLIC_`** — it stays on the server. The browser never calls the Cortex backend directly; all backend traffic goes through `/api/proxy/*`, `/api/ask/stream`, or `/api/me/upload`, which inject the right minted `X-API-Key` from SQLite. Deprecated aliases `NEXT_PUBLIC_API_URL` and `LIBRARY_API_URL` are mirrored onto `CORTEX_API_URL` at boot in `src/instrumentation.ts` with a console warning.
- Required env (`BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`) is validated at boot in `src/instrumentation.ts`. Missing or malformed values cause startup to throw a single aggregated error — do not paper over this with optional-chaining downstream.
- German UI uses du-form; keep product terms (Deep Research, Content Role, etc.) in English even in German locale
- Route handlers validate input with `zod`; admin routes gate with `requireSuperadmin()`; user-self routes gate with `requireAuth()`; anonymous routes (`/api/auth/login`, `/api/config`) are in the middleware's `PUBLIC_PATHS` allowlist.
- Passwords hashed with `argon2id` (`hashPassword`/`verifyPassword` in `src/lib/auth/password.ts`). Never log or return password hashes.
- Backend API keys are encrypted with `encryptSecret` before being inserted; decrypt on use with `decryptSecret` (`src/lib/auth/crypto.ts`). Never expose a decrypted key to the client.
