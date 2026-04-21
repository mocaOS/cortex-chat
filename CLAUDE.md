# CLAUDE.md

## Project Overview

Next.js 16 multi-tenant chat suite for a RAG-based AI knowledge assistant (library-backend).

**Key features:**
- Email/password auth backed by server-side sessions (SQLite)
- Superadmin-provisioned users and user groups
- Per-group read-only API keys (chat); per-user manage keys (document upload / "content roles")
- Streaming SSE responses from backend (`/api/ask/stream`)
- Chat and Deep Research modes
- Collection-scoped search (default: all collections the user's group can read)
- Source citations with modal viewer
- Graph context (entities/relationships), thinking steps
- i18n (EN/DE), locale set via config
- Server-side chat history, synced across devices per user
- Auto-generated chat titles via LLM after first response
- Configurable accent color, logo, locale via `/api/config` endpoint
- Login history + usage analytics for the superadmin

## Auth & Users

- **Superadmin** is bootstrapped from env (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`). On every server start the row is upserted with a fresh `argon2id` hash — rotating the password means editing env and restarting.
- **Users** are created by the superadmin (email + initial password). Each user belongs to exactly one `group`. Users can update their username, avatar, and password.
- **Sessions** are DB-backed (`sessions` table) with an opaque cookie token. 30-day sliding TTL. Middleware checks cookie presence; route handlers validate against DB via `getAuth()` / `requireAuth()` / `requireSuperadmin()` in `src/lib/auth/session.ts`.

## API Keys — How we talk to library-backend

Frontend never sees backend keys. All keys are stored **encrypted at rest** in SQLite (`api_keys.encrypted_value`, AES-256-GCM, key from `APP_ENCRYPTION_KEY`) and injected by server routes as the `X-API-Key` header.

Three kinds of key in play:

| Key | Permission | Stored where | Used for |
|-----|------------|--------------|----------|
| `BACKEND_ADMIN_API_KEY` (env) | `admin` | env only | Superadmin operations: mint per-group/per-user keys via `POST /api/admin/keys`, list collections for the group editor |
| Group chat key | `read`, scoped to collections | `api_keys`, referenced by `groups.chat_key_id` | Every `/api/ask*` and `/api/search*` request from a user in that group |
| User content key | `manage`, scoped to collections | `api_keys`, referenced by `users.content_key_id` | `/api/me/upload` — only users granted a content role can upload documents |

**Collection scoping** — `api_keys.collection_ids` is a JSON array; `[]` means all collections (matches library-backend convention). The library-backend automatically filters reads by the key's scope, so the chat dropdown will only show collections the user's group can access.

## Upload flow — "no extraction in UI"

`POST /api/upload` on the library-backend triggers extraction automatically; there is no flag to skip it. We honor the "never start extraction" UX requirement by **confirming upload as soon as the HTTP response lands** (typically the upstream's initial 202 / 200) and **never surfacing extraction progress** in this UI. Extraction still runs asynchronously in the backend; it's simply not this app's concern.

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
- **One accent per screen.** Accent = primary CTA, active nav, live/running state, citation badges. Not for hover backgrounds, generic highlights, or decoration. The accent is runtime-configurable (`ACCENT_COLOR` env + `/api/config`); default is `oklch(0.79 0.18 70.67)` (warm yellow-green).
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
  - `data/cortex-chat.db` — SQLite DB (users, groups, api_keys, sessions, login_events, chat_sessions, chat_messages, usage_events)
  - `data/avatars/<userId>.webp` — user profile images
- `data/` is gitignored and intended to be bind-mounted in Docker (see `docker-compose.yml`).
- Schema lives in `src/lib/db/schema.ts`; migrations in `src/lib/db/migrations/` (generated via `npm run db:generate`, applied on server start via `src/instrumentation.ts` and manually via `npm run db:migrate`).

## Conventions

- Hex color values must be quoted in `.env` files (e.g. `"#ff9500"`) because `#` is treated as a comment by dotenv
- `NEXT_PUBLIC_` vars are compile-time inlined by Next.js — runtime config uses `/api/config` endpoint instead. **Server-side secrets (`BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, `SUPERADMIN_*`) must never be prefixed with `NEXT_PUBLIC_`** — they stay on the server.
- German UI uses du-form; keep product terms (Deep Research, Content Role, etc.) in English even in German locale
- Route handlers validate input with `zod`; admin routes gate with `requireSuperadmin()`; user-self routes gate with `requireAuth()`; anonymous routes (`/api/auth/login`, `/api/config`) are in the middleware's `PUBLIC_PATHS` allowlist.
- Passwords hashed with `argon2id` (`hashPassword`/`verifyPassword` in `src/lib/auth/password.ts`). Never log or return password hashes.
- Backend API keys are encrypted with `encryptSecret` before being inserted; decrypt on use with `decryptSecret` (`src/lib/auth/crypto.ts`). Never expose a decrypted key to the client.
