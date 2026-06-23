# CLAUDE.md

## Project Overview

Cortex Chat — a Next.js 16 multi-tenant chat suite for the Cortex RAG-based AI knowledge assistant (upstream codename: `library-backend`).

**Key features:**
- Email/password auth backed by server-side sessions (SQLite)
- Superadmin-provisioned users and user groups
- Per-group read-only API keys (chat); per-user manage keys (document upload / "content roles")
- Streaming SSE responses from backend (`/api/ask/stream`), with structured `status` stage events driving the live thinking indicator
- Conversation memory — client-carried, server-persisted opaque blob for cross-turn recall, citation continuity (`sid`), and a memory-only fast-path
- Chat and Deep Research modes
- Collection-scoped search (default: all collections the user's group can read)
- Source citations with modal viewer
- Graph context (entities/relationships), thinking steps
- i18n (EN/DE), locale set via config
- Server-side chat history, synced across devices per user
- Auto-generated chat titles via LLM after first response
- Configurable accent color, logo, locale via `/api/config` endpoint
- Admin-defined `<cortexchatanalytics>` context block, injected server-side into every backend request for consumption by agent skills
- Login history + usage analytics for the superadmin

## Auth & Users

- **Superadmin** is bootstrapped from env (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`). On every server start the row is upserted with a fresh `argon2id` hash — rotating the password means editing env and restarting.
- **Default group** — on the first boot of a fresh database, a "Default" group (read key over all collections) is auto-created and the superadmin is assigned to it, so chat works without a manual trip through `/admin/groups` (`src/lib/default-group-bootstrap.ts`). Runs in the background with spaced retries (the Cortex backend may still be starting); guarded by the `defaultGroupProvisioned` marker in `app_settings`, so it happens at most once per DB — deployments that already have groups are adopted as-is, and deleting the group later won't resurrect it on restart.
- **Users** are created by the superadmin (email + initial password). Each user belongs to exactly one `group`. Users can update their username, avatar, and password.
- **Sessions** are DB-backed (`sessions` table) with an opaque cookie token. 30-day sliding TTL. Middleware checks cookie presence; route handlers validate against DB via `getAuth()` / `requireAuth()` / `requireSuperadmin()` in `src/lib/auth/session.ts`.

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

`POST /api/upload` on the Cortex backend triggers extraction automatically; there is no flag to skip it. We honor the "never start extraction" UX requirement by **confirming upload as soon as the HTTP response lands** (typically the upstream's initial 202 / 200) and **never surfacing extraction progress** in this UI. Extraction still runs asynchronously in Cortex; it's simply not this app's concern.

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
- **Persistence.** Stored per session in `chat_sessions.memory` (nullable JSON TEXT, migration `0002`). PATCH `/api/me/chats/[id]` folds it into the messages transaction so a settled turn is atomic; GET returns it; loaded on session select, reset on new/delete. Survives reload and device-switch like chat history.
- **Citation continuity.** Each `sources[]` item now carries a conversation-stable `sid`. It rides inside the sources array, so it persists in message metadata and reloads automatically — no separate map, no rendering change.
- **Status events.** `status` `{stage, message}` drives the `ThinkingIndicator` label directly (`message.status.message`), falling back to the old field-presence heuristic when absent. The memory fast-path (no `searching`/`sources`) is handled by this automatically.
- **Heartbeats.** `: ping` comment lines need no handling — the parser only acts on `data:` lines.

## Backend resilience (v-next behaviors)

Adopted from the cortex-app v-next hand-off notes; all additive and backward-compatible.

- **429 + Retry-After.** Deployments with `RATE_LIMIT_QPM` return 429 with `Retry-After` on bursts (besides the monthly-quota 429). All proxy routes pass `Retry-After` through; the client never auto-retries a 429 — `apiFetch` throws `RateLimitError`, `askQuestionStream` calls `onRateLimited`, and the UI shows a localized "slow down" message (`rateLimited`/`rateLimitedNoTime`) in chat and on upload.
- **`event: shutdown` SSE frame.** On rolling restarts the backend ends active streams with `event: shutdown` instead of a dead socket. `askQuestionStream` transparently resubmits (max 2 reconnects, same `X-Request-ID`); `onReconnect` clears the partial assistant message so the regenerated answer streams clean.
- **`X-Request-ID` correlation.** The client generates one id per user action (one per stream, stable across shutdown reconnects); every proxy route reuses-or-mints it, forwards it upstream, and echoes it on the response. The admin client (`src/lib/backend/index.ts`) mints one per call. Lines across chat → backend → cortex-helper share one id (`LOG_FORMAT=json` upstream).
- **Retry wrapper.** `apiFetch` retries 3 attempts with exponential backoff + jitter (0.5–4s): GETs on connect failure and 5xx; non-GETs only on fetch rejection (no response received — the browser approximation of connect-failure-before-send). Never on 429.
- **Collections cache.** `GET /api/collections` has no pagination upstream (verified); `fetchCollections` caches client-side for 60s with in-flight dedup.
- **Titles.** Chat titles come from the first user message (no LLM call) and are guarded once-per-session via `titleGeneratedRef` — nothing regenerates on reconnect/replay, so no tenant LLM budget is burned.
- **Keep `Accept-Encoding: identity`** on the SSE proxy. The v-next nginx config disables buffering on `/api/ask/stream`, which will make it redundant once deployed everywhere — but it stays harmless; don't remove it this cycle.

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
  - `data/cortex-chat.db` — SQLite DB (users, groups, api_keys, sessions, login_events, chat_sessions [incl. opaque `memory` blob], chat_messages, usage_events)
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
