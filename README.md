# Cortex Chat

A lean, multi-tenant chat frontend for [Cortex](https://github.com/mocaOS/cortex-app) instances. Gives end users a clean "Ask AI" interface to query their knowledge base, with admin tools for user management, group-scoped collection access, and document uploads.

Built with Next.js, React, and Tailwind CSS.

## What is Cortex?

Cortex is an agentic knowledge base that transforms documents into a searchable, AI-powered knowledge graph. It ingests PDFs, Markdown, DOCX, and more, then uses LLM-driven entity and relationship extraction (GraphRAG) to build a semantic network that grows smarter with every document.

It combines three search strategies — vector similarity, keyword matching, and graph traversal — fused via Reciprocal Rank Fusion to deliver answers that go beyond simple semantic search. For complex questions, an agentic Deep Research mode decomposes queries into sub-questions, searches independently, and synthesizes comprehensive answers with visible reasoning chains.

Cortex Chat connects to any Cortex instance via its REST API and mints scoped per-group / per-user keys from a single admin-tier key you provide.

## Features

### Chat
- **Ask AI** — single-purpose chat interface for querying your knowledge base
- **Streaming responses** — real-time token-by-token answer rendering via Server-Sent Events, proxied through a Next.js API route to avoid gzip buffering (toggleable in settings)
- **Deep Research mode** — agentic multi-step RAG for complex questions, with live thinking steps (auto-expanding during streaming), retrieval progress, and sub-question decomposition
- **Inline citations** — `[src_N]` annotations render as clickable numbered badges linked to source documents
- **Source explorer** — click any citation or source chip to view the full document chunk in a modal with relevance scores
- **Collection scoping** — defaults to all collections the user's group has access to; narrow to a single collection via the settings panel
- **Conversation history** — multi-turn chat with full context passed to the backend
- **Server-side chat history** — sessions, messages, and auto-generated titles persist per-user in SQLite, so chats follow the user across devices

### Multi-tenant auth & admin
- **Email/password sessions** — `argon2id` password hashing, opaque session cookies with a 30-day sliding TTL, stored server-side in SQLite
- **Superadmin bootstrap** — superadmin row is upserted from env on every boot (rotate by editing env + restart)
- **User & group management** — superadmin creates users at `/admin`, assigns each to exactly one group, and edits per-group collection scope
- **Per-group read keys** — every chat request uses the group's `read`-scoped Cortex backend key, minted by the superadmin and stored AES-256-GCM encrypted at rest
- **Per-user content roles** — selected users get a `manage`-scoped key for document upload at `/upload`; admin/superadmin upload via the env admin key
- **Login & usage analytics** — superadmin dashboard charts login activity and chat usage
- **Cortex chat analytics** — admins define a `<cortexchatanalytics>` block in `/admin/settings` that is injected server-side into every backend request (after `$userEmail` / `$userName` substitution). Invisible in the chat UI; readable by backend agent skills for use cases like routing chat summaries to external systems

### Branding & UX
- **Runtime branding** — accent color, logo, page title, description, and default language are edited by the superadmin at `/admin/settings` and stored in SQLite. No env vars, no rebuilds.
- **Cortex design system** (a MOCA-derived spec) — dark-first, monochrome OKLCh + one accent, glass on chrome / opaque cards
- **Multilingual** — English and German, selectable per-deployment
- **Responsive** — comfortable on both mobile and desktop

## Getting Started

### Prerequisites

- Node.js 18+
- A running Cortex instance
- An **admin-tier** API key (`moca_admin_...`) from your Cortex instance — used server-side to mint per-group / per-user keys

### Installation

```bash
npm install
```

### Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env.local
```

All configuration is server-side, read at runtime. The browser bundle contains zero secrets and zero deploy-specific values.

| Variable | Description | Default |
|---|---|---|
| `CORTEX_API_URL` | URL of your Cortex backend. The browser never calls the backend directly — all traffic goes through this app's server-side proxy. | `http://localhost:8000` |
| `BACKEND_ADMIN_API_KEY` | Admin-tier Cortex backend key. Used to mint per-group/per-user keys and list collections in the admin UI. | — |
| `SUPERADMIN_EMAIL` | Bootstraps the `superadmin` user on every server start. | — |
| `SUPERADMIN_PASSWORD` | Re-hashed (argon2id) on every boot, so rotating means editing env + restart. | — |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64-encoded (`openssl rand -base64 32`). Encrypts Cortex backend keys at rest in SQLite (AES-256-GCM). | — |
| `DATABASE_PATH` | SQLite file path. Avatars live alongside it under `<dirname>/avatars/`. | `./data/cortex-chat.db` |

> **Branding is DB-backed.** Accent color, logo, page title, description, and default language are managed at runtime by the superadmin at `/admin/settings` and stored in SQLite. Changing branding never requires a rebuild or a restart.
>
> **Security note:** Never prefix `BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, or `SUPERADMIN_*` with `NEXT_PUBLIC_` — those would be baked into the client bundle.
>
> **Fail-fast validation:** On boot the app validates that `BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY` (32-byte base64), `SUPERADMIN_EMAIL`, and `SUPERADMIN_PASSWORD` are present and well-formed. Misconfigured deploys exit with a single error listing every issue.

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

## Docker Deployment

The project ships with a multi-stage Dockerfile and Docker Compose file for production deployment. There are no build-time env vars — every deploy-specific value is runtime, so the same image can serve any tenant.

### Docker (standalone)

```bash
docker build -t cortex-chat .

docker run -p 3000:3000 \
  -e CORTEX_API_URL=https://your-cortex-instance.com \
  -e BACKEND_ADMIN_API_KEY=moca_admin_your-admin-key \
  -e SUPERADMIN_EMAIL=admin@example.com \
  -e SUPERADMIN_PASSWORD=change-me \
  -e APP_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -v cortex-chat-data:/app/data \
  cortex-chat
```

After first boot, log in as the superadmin and customize branding (accent, logo, title, language) at `/admin/settings`.

### Docker Compose

1. Create a `.env` file (or copy from `.env.example`):

```bash
CORTEX_API_URL=https://your-cortex-instance.com
BACKEND_ADMIN_API_KEY=moca_admin_your-admin-key
SUPERADMIN_EMAIL=admin@example.com
SUPERADMIN_PASSWORD=change-me
APP_ENCRYPTION_KEY=base64-32-bytes-here

PORT=3000
```

2. Build and run:

```bash
docker compose up -d --build
```

### Coolify

1. Create a new **Docker Compose** resource in Coolify
2. Point it to this repository
3. Set the variables in Coolify's environment settings (all runtime):

| Variable | Value |
|---|---|
| `CORTEX_API_URL` | URL of your Cortex backend |
| `BACKEND_ADMIN_API_KEY` | Your admin-tier Cortex backend key |
| `SUPERADMIN_EMAIL` | Bootstrap email for the superadmin |
| `SUPERADMIN_PASSWORD` | Bootstrap password for the superadmin |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64-encoded |

4. Set the port to `3000`
5. Deploy — Coolify builds the image and starts the container. Branding is configured in `/admin/settings` after first login.

### Other Platforms (Railway, Render, Fly.io, etc.)

Any platform that supports Dockerfile-based builds will work. Set the variables above as **runtime** environment variables (no build args). The container exposes port `3000` and persists state under `/app/data` — mount a volume there.

## How It Works

### Chat Flow

1. User types a question and hits send (or presses Enter)
2. The frontend sends a POST request to the local `/api/ask/stream` proxy, which forwards it to the backend with `Accept-Encoding: identity` to prevent gzip buffering of the SSE stream
3. The backend streams SSE events: `sources` → `graph_context` → `content` tokens → `done`
4. In Deep Research mode, additional events appear before content: `thinking` steps (displayed live in an auto-expanding panel), `sub_questions`, `retrieval` progress, and `retrieval_stats`
5. Citations in the answer (`[src_1]`, `[src_2]`, etc.) are rendered as interactive badges that open the source modal

### Runtime Configuration

All branding (accent color, logo, page title, description, default language) lives in the `app_settings` SQLite table and is edited by the superadmin at `/admin/settings`. The server SSRs the values into the initial HTML (no flash of defaults), and `/api/config` returns them at runtime for client-side reactivity.

### Authentication & key model

#### Mental model in one paragraph

There is **one** privileged backend key — `BACKEND_ADMIN_API_KEY` — which lives in env and never leaves the server. The app uses it as a "factory" to mint **narrower, per-tenant keys** against the Cortex backend: a `read`-scoped key per group (for chat), and optionally a `manage`-scoped key per user (for uploads). Those minted keys are stored encrypted in this app's SQLite and injected as `X-API-Key` when the relevant user makes a request. So end users never see any key — they just have a session cookie, and the server picks the right minted key based on their group / role.

#### User roles

Roles live in `users.role`. Three values, each gating what's reachable in the UI and what kind of key resolves on backend calls:

| Role | Who | What they can do | Which key signs their backend calls |
|---|---|---|---|
| `superadmin` | Exactly one; bootstrapped from env on every boot (`SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD`, re-hashed with argon2id each start) | Everything an `admin` can do, plus manage/promote/demote `admin` users | Env admin key for uploads; otherwise the minted keys below |
| `admin` | Created by the superadmin (or another admin) | Full `/admin` access: create users + groups, mint group chat keys, grant content roles, edit settings, view analytics, manage the logo / cortex chat analytics template | Env admin key for uploads (bypasses the content-role flow); read access still goes via the group's chat key |
| `user` | Default for created accounts; belongs to exactly one group | Chat, browse history, edit own profile / avatar / password. If granted a "content role" by an admin, can also upload documents at `/upload` | Group's read key for chat; their own minted manage key for uploads (only if content role granted) |

#### Key hierarchy

| Key | Permission | Stored where | Used for | Created by |
|---|---|---|---|---|
| `BACKEND_ADMIN_API_KEY` (env) | `admin` | env only — never written to SQLite, never sent to the browser | Mints per-group / per-user keys, lists collections in the admin UI, signs admin & superadmin uploads | You, when you generate an admin-tier key in your Cortex backend |
| Group chat key | `read`, scoped to a set of collections | `api_keys.encrypted_value` (AES-256-GCM with `APP_ENCRYPTION_KEY`), referenced by `groups.chat_key_id` | Every `/api/ask*` and `/api/proxy/*` call by a user in that group | The app, when an admin creates a group — calls the Cortex backend with the env admin key to mint a `read` key, then encrypts + stores the response |
| User content key | `manage`, scoped to a set of collections | `api_keys.encrypted_value`, referenced by `users.content_key_id` | `/api/me/upload` — only `user`-role accounts granted a content role have one | The app, when an admin grants the user a content role — same minting flow, but `manage` scope |

So every key in `api_keys` was minted by the env admin key against **one specific Cortex backend instance**. Re-pointing `CORTEX_API_URL` at a different backend invalidates them all (see "Switching backends" below).

#### Sessions

Users sign in with email + password (argon2id). Sessions are DB-backed (`sessions` table) with an opaque cookie token and a 30-day sliding TTL. Middleware checks for the cookie on protected routes; route handlers re-validate against DB via `getAuth()` / `requireAuth()` / `requireAdmin()` / `requireSuperadmin()`.

#### Collection scoping

`api_keys.collection_ids` is a JSON array; `[]` means "all collections" (matches the Cortex backend convention). The backend filters reads by the key's scope automatically, so the in-UI collection dropdown only ever shows collections the user's group is actually allowed to see.

#### Switching backends

Group chat keys are minted *against a specific backend instance* — they live in that backend's own key store. If you re-point `CORTEX_API_URL` at a different backend, every key in your `api_keys` table is unknown to the new backend, and every chat call returns `401`. There is currently no in-UI "rotate key" action on an existing group. To recover:

1. **Recreate the group.** At `/admin`, create a new group (this mints a fresh chat key against the now-current backend). Reassign users to the new group via the user editor. Delete the old group. Per-user chat history survives because it's keyed by user, not group.
2. **Or, in dev, wipe the DB.** `rm data/cortex-chat.db` and restart — the superadmin is re-bootstrapped from env automatically. You'll lose users, groups, and chat history, but it's the fastest reset.

### Cortex chat analytics injection

Admins can define a template in `/admin/settings` (stored in the `app_settings` table, key `cortexAnalyticsTemplate`). On every `/api/ask/stream` call, the server proxy:

1. Renders the template — `$userEmail` and `$userName` are replaced with the authenticated user's values (username falls back to email when blank).
2. Prepends the rendered string as the first entry of `conversation_history` (`role: "user"`) before forwarding to the Cortex backend.
3. Never round-trips the block to the browser or persists it in `chat_messages` — re-applied per request from current settings + auth context.

Example template:

```
<cortexchatanalytics>
This conversation was held by $userEmail (name: $userName)
</cortexchatanalytics>
```

Backend agent skills (loaded from `SKILL.md` at the start of every chat session) can read the block and, for example, post chat summaries to a CRM or BI tool with the user identity attached. Leave the template empty to disable injection entirely.

## Project Structure

```
src/
├── app/
│   ├── admin/                  # superadmin dashboard (users, groups, analytics, settings)
│   ├── api/
│   │   ├── admin/              # superadmin-only routes: users, groups, content-roles, library, keys, logo, settings, login-events, analytics
│   │   ├── ask/stream/         # SSE chat proxy (bypasses gzip buffering, injects cortex chat analytics)
│   │   ├── auth/               # login, logout, session/me
│   │   ├── avatars/            # serves user avatar files
│   │   ├── branding/           # serves uploaded logo
│   │   ├── config/             # runtime config (accent color, logo URL, locale, upload limits)
│   │   ├── me/                 # self-service: profile, password, avatar, chats, upload, upload-scope
│   │   └── proxy/[...path]/    # generic backend proxy for read-scope calls (e.g. collections)
│   ├── login/                  # login page
│   ├── profile/                # profile (username, avatar, password)
│   ├── upload/                 # content-role upload UI
│   ├── globals.css             # MOCA design tokens, dark theme, markdown + citation styles
│   ├── layout.tsx              # Root layout (dark class, branding bootstrap)
│   └── page.tsx                # Main chat page (state, API orchestration)
├── components/
│   ├── admin/                  # AdminShell, Modal, shared admin UI primitives
│   ├── ChatInput.tsx           # Text input, mode toggle, settings cog
│   ├── MessageList.tsx         # Scrollable message area with empty state
│   ├── MessageBubble.tsx       # User/assistant messages, thinking steps, inline citations
│   ├── SettingsPanel.tsx       # Streaming toggle + collection scope selector
│   ├── Sidebar.tsx             # Slide-in chat history (server-side, per-user)
│   ├── SourceModal.tsx         # Full source content viewer
│   ├── Header.tsx              # Logo + sidebar toggle
│   └── ConfigBootstrap.tsx     # Loads /api/config on mount, applies CSS vars + locale
├── lib/
│   ├── auth/
│   │   ├── session.ts          # getAuth / requireAuth / requireSuperadmin, cookie session lookup
│   │   ├── password.ts         # argon2id hash / verify
│   │   ├── crypto.ts           # AES-256-GCM encryptSecret / decryptSecret (APP_ENCRYPTION_KEY)
│   │   ├── backend-key.ts      # getGroupChatKey / getUserContentKey — resolves the X-API-Key for backend calls
│   │   ├── superadmin-bootstrap.ts # upserts superadmin row from env on every boot
│   │   └── cookie.ts
│   ├── backend/                # Cortex backend admin client (mint keys, list collections via BACKEND_ADMIN_API_KEY)
│   ├── db/
│   │   ├── schema.ts           # Drizzle schema (users, groups, api_keys, sessions, chat_sessions, chat_messages, login_events, usage_events, app_settings)
│   │   ├── client.ts           # better-sqlite3 + Drizzle setup
│   │   ├── migrate.ts          # applied on server start via instrumentation
│   │   └── migrations/         # Drizzle-generated SQL
│   ├── api.ts                  # client-side API helpers (ask, stream parsing, title generation)
│   ├── cortex-analytics.ts     # template render + conversation_history injection (server-only)
│   ├── settings.ts             # app_settings accessors + CORTEX_ANALYTICS_VARIABLES registry
│   ├── config.ts               # runtime config payload builder
│   ├── branding.ts             # logo file + uploaded asset paths
│   ├── chatHistory.ts          # client-side chat session helpers
│   └── i18n.ts                 # en/de translations
├── middleware.ts               # cookie-based gate on protected routes (PUBLIC_PATHS allowlist for login, config, auth callbacks)
└── instrumentation.ts          # boot hook: runs migrations + superadmin bootstrap
```

Runtime state lives under `./data/`:
- `data/cortex-chat.db` — SQLite database (users, groups, api_keys, sessions, login_events, chat_sessions, chat_messages, usage_events, app_settings)
- `data/avatars/<userId>.webp` — user profile images
- `data/branding/` — uploaded logo

The `data/` directory is gitignored and meant to be bind-mounted as a volume in Docker (see `docker-compose.yml`). Schema changes are generated with `npm run db:generate` and applied automatically on server start (or manually via `npm run db:migrate`).

## Tech Stack

- **Next.js 16** (App Router, Turbopack, standalone output)
- **React 19**, **TypeScript 5**
- **Tailwind CSS 4** with the Cortex design system (dark-first, OKLCh tokens)
- **SQLite** + **better-sqlite3** + **Drizzle ORM** for users, sessions, groups, keys, chat history, analytics
- **@node-rs/argon2** for password hashing, **AES-256-GCM** (Node `crypto`) for at-rest key encryption
- **zod** for route input validation
- **Recharts** for the admin analytics dashboard
- **react-markdown** + **remark-gfm** for rendering markdown responses
- **Docker** multi-stage build with standalone output
