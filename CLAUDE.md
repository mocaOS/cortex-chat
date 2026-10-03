# CLAUDE.md

Cortex Chat — a Next.js 16 multi-tenant chat suite for the Cortex RAG-based AI knowledge assistant (upstream codename: `library-backend`). Part of a multi-repo product with cortex-app (backend) and cortex-skills; this repo owns the chat UI and its own SQLite/file/encryption state. Detailed feature behavior lives in the scoped guides (Map below) — read the one you touch before editing it.

## Session contract — seven primitives

- **Start:** check `git status` for uncommitted work; read the scoped guide for your area (Map) and `docs/regeneration/index.md` for gates, capability inventory, and the current checkpoint.
- **Intent:** name the outcome and the preserved promises. Intentional behavior changes must be explicit and recorded — default is preservation.
- **Compilation:** identify the unit, its public boundary, state owner, consumers, and allowed effects. Boundary/state ownership is documented per guide (esp. `operations-and-state.md`).
- **Evaluations:** choose the oracle and required checks BEFORE changing code. Gates: `npm run typecheck` + `npm test` (deterministic contract suite; see `docs/regeneration/index.md`). Never lower a gate to fit a candidate.
- **Provenance:** record decisions, commands, results, and limitations in `docs/regeneration/records/`.
- **Pace:** match verification to coupling — state, crypto, session, or proxy changes need the SQLite/crypto/retry gates; UI-only changes need typecheck plus a manual dark-mode check in both locales.
- **Deletion:** map consumers and removal conditions first; never delete durable knowledge or state with its container (`data/` DB + WAL + avatars + branding; `APP_ENCRYPTION_KEY` guards `api_keys.encrypted_value` — losing it loses every stored key).
- **Compaction:** remove superseded complexity in the same slice; keep exactly one canonical owner per rule (root here; details in guides; never duplicate).
- **Finish:** verify the integrated candidate against the gates, update the owning docs (root + guide + public docs as applicable), harvest incident lessons into the narrowest owning guide, state your actual evidence claim, and leave the next actionable step.

## Hard constraints (every session)

- Preserve production behavior by default; this repo's public docs for operators live in the cortex-app `documentation/` tree — changes there belong to that repo's owners.
- Server secrets (`CORTEX_API_URL`, `BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, `SUPERADMIN_*`) must never be `NEXT_PUBLIC_`-prefixed; the browser only ever talks to this app's own `/api/*` routes.
- Required env is boot-validated in `src/instrumentation.ts` — don't paper over boot failures downstream.
- Anonymize customer-facing content everywhere: no tenant/customer names, instance hostnames, or real keys/IDs in commits, docs, tests, or fixtures.
- No git commit/reset/stash, deployments, or live-datastore access unless explicitly asked.

## Map

| Area | Scoped guide |
|---|---|
| Auth, users, sessions, OIDC, password reset/email, registration, demo mode | `.claude/guides/auth-and-identity.md` |
| Backend keys & proxies, upload, web import, analytics injection, resilience, collection scoping | `.claude/guides/cortex-backend-integration.md` |
| Streaming/memory contract, chat UX, souls, projects, voice | `.claude/guides/chat-streaming-memory.md` |
| Tech stack, design system, copy/locale conventions | `.claude/guides/design-system.md` |
| Storage, SQLite/migrations, encryption, env conventions, GlitchTip | `.claude/guides/operations-and-state.md` |

## Commands

- `npm run typecheck` — type gate (`tsc --noEmit`; a typecheck is not a linter); `npm test` — deterministic contract suite (node:test via tsx, shell-independent runner)
- `npm run dev` / `npm run build` / `npm start`; `npm run db:generate` / `npm run db:migrate`

Cross-repo campaign context: `../cortex-app/.claude/regeneration.md` (read if present; this repo stands alone without it). Harness note: `AGENTS.md` is an explicit read fallback for non-Claude harnesses — automatic loading of either entry file is documented expectation, not observed delivery, except where a fresh-session check is recorded in `docs/regeneration/`.
