# Password Reset & Email Sending — Design

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation plan

## Goal

Let users reset a forgotten password via a self-service flow, and let admins
trigger a reset email for any user. This requires the app's first email-sending
capability, built as a reusable, branded email module so future transactional
emails can reuse it.

## Scope

**In scope**
- Self-service "Forgot password?" flow (login page → request → email link → set new password).
- Admin-triggered "Send reset email" from `/admin/users`.
- SMTP email sending via `nodemailer`, configured entirely by env vars.
- A reusable, server-only email module: branded HTML layout + per-email templates.
- Reset emails styled from the existing DB-backed branding (accent color, logo, app title).
- Migration for a `password_reset_tokens` table.
- EN/DE localization for the new UI and the email copy.
- Unit tests + manual verification via Mailpit.

**Out of scope (YAGNI for now)**
- DB-backed / admin-editable SMTP settings (env only).
- Per-recipient email language preference (emails use the app's configured default locale).
- Any transactional email other than password reset (the module is built to be extended later).
- Email delivery/bounce tracking.

## Key decisions (locked)

| Decision | Choice |
|---|---|
| Reset entry points | Self-service **and** admin-triggered |
| SMTP config | **Env vars only**; feature-gated (off until configured) |
| Email branding source | **Reuse DB-backed branding** (`app_settings`: accent, logo, title) |
| Mailer | `nodemailer` |
| Template engine | Hand-rolled layout + `${var}` substitution (no MJML/react-email) |
| Token TTL | 60 minutes |
| Token storage | SHA-256 hash at rest; plaintext only in the emailed link; single-use |
| Session handling on reset | Invalidate **all** of that user's sessions |
| Reset link base URL | New `APP_BASE_URL` env (never the request `Host` header) |
| Logo in email | Inline **CID attachment** (read from branding dir) |
| Email copy location | Server-side in the email module (never ships to the client bundle) |
| Superadmin | Excluded from reset (password is env-managed); enumeration-safe no-op — mirrors the existing user-edit route |

## Architecture

A self-contained, server-only email module under `src/lib/email/`, a new
`password_reset_tokens` table, two public pages + two public API routes for
self-service, and one admin API route. The email capability is **feature-gated**:
when `SMTP_HOST` is unset, no mail is sent and the admin button is disabled — the
app behaves exactly as it does today.

```
Browser (login)
  └─ "Forgot password?" → /forgot-password ──POST──▶ /api/auth/forgot-password
                                                        │ (enumeration-safe, always 200)
                                                        ├─ create token (hash stored)
                                                        └─ send email (if configured)
Email link → /reset-password?token=… ──POST──▶ /api/auth/reset-password
                                                  ├─ validate token
                                                  ├─ set new password hash
                                                  ├─ mark token used
                                                  └─ delete all user sessions

Admin (/admin/users) "Send reset email" ──POST──▶ /api/admin/users/[id]/send-reset
                                                     └─ same token + email machinery
```

## Configuration (env)

```
SMTP_HOST                 # e.g. localhost (feature switch: unset ⇒ email disabled)
SMTP_PORT                 # e.g. 1025 (Mailpit SMTP) or 587
SMTP_USER                 # optional (omit for Mailpit)
SMTP_PASS                 # optional (omit for Mailpit)
SMTP_SECURE               # optional bool; true ⇒ implicit TLS (465), default false (STARTTLS)
SMTP_FROM                 # e.g. "Cortex Chat <no-reply@example.com>"
APP_BASE_URL              # e.g. https://chat.example.com — absolute base for reset links
```

**Validation (boot, in `src/instrumentation.ts`):** if `SMTP_HOST` is set, then
`SMTP_FROM` and `APP_BASE_URL` are required — otherwise aggregate a boot error
consistent with the existing `validateRequiredEnv()` pattern. If `SMTP_HOST` is
unset, none of the SMTP vars are required and email features stay off.

**Mailpit note:** port `8025` is Mailpit's **web UI** (for viewing mail). Its
**SMTP** port is `1025`. Local dev values:
`SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_FROM=…`, `APP_BASE_URL=http://localhost:3000`.
Then read delivered mail at `http://localhost:8025`.

`.env.example` and `docker-compose.yml` get the new (optional) vars documented.

## Data model — migration `0003`

```sql
CREATE TABLE password_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,        -- sha256(token); plaintext lives ONLY in the emailed link
  expires_at integer NOT NULL,
  used_at integer,                 -- null until consumed (single-use)
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_prt_user_id ON password_reset_tokens(user_id);
```

Add the Drizzle table to `src/lib/db/schema.ts` and generate the migration via
`npm run db:generate` (applied on boot by `src/instrumentation.ts`).

## Token lifecycle

- **Generate:** 32 random bytes → base64url (same primitive as `newSessionToken`). Store `sha256(token)` in `token_hash`. The plaintext token appears only in the emailed link.
- **TTL:** `expires_at = now + 60 min`.
- **One active per user:** creating a new token deletes prior *unused* tokens for that user.
- **Single-use:** on successful reset, set `used_at = now`.
- **On reset success:** update `users.password_hash`, mark token used, and delete **all** sessions for that user (force re-login on every device — matches the existing change-password behavior in `src/app/api/me/password/route.ts`).
- **Lookup:** hash the incoming token and match on `token_hash`; reject if missing, `used_at` set, or `expires_at < now`.

## API routes

### `POST /api/auth/forgot-password` (public)
- Body: `{ email: string }` (zod).
- **Always returns `200 { ok: true }`** regardless of whether the account exists (enumeration-safe).
- If the user exists **and** is not the superadmin **and** email is configured: create a token and send the reset email.
- **Superadmin is excluded:** if the email belongs to the superadmin, issue no token and send no mail (its password is env-managed). Still returns 200 (enumeration-safe).
- Light abuse guard: the "one active token per user" rule plus a short cooldown (skip issuing/sending if an unused, unexpired token was created within the last ~60s). Still returns 200.

### `POST /api/auth/reset-password` (public)
- Body: `{ token: string, newPassword: string (min 8) }` (zod).
- Validates the token; on success sets the password, marks the token used, kills all sessions.
- Returns `200 { ok: true }` or `400 { error }` for invalid/expired/used tokens.

### `GET /api/auth/reset-password?token=…` (public)
- Lightweight validity probe so `/reset-password` can show "link expired" on load instead of only after submit.
- Returns `{ valid: boolean }`. Does not reveal any user data.

### `POST /api/admin/users/[id]/send-reset` (admin)
- Gated by `requireAdmin()` (superadmin + admin).
- **Authorization mirrors `PATCH /api/admin/users/[id]`:** an `admin` caller may target only regular users — targeting an `admin` or `superadmin` returns `403`. A `superadmin` caller may target any regular or `admin` user.
- **Superadmin target is always rejected** (`400`, "managed via env") for every caller, since a reset would revert on the next boot.
- Mints a token for the (permitted) target user and sends the reset email.
- If email is not configured → `400 { error }` with a clear hint. Returns `200 { ok: true }` on success.

### Middleware
Add to `PUBLIC_PATHS` in `src/middleware.ts`:
`/forgot-password`, `/reset-password`, `/api/auth/forgot-password`, `/api/auth/reset-password`.

## Email module (`src/lib/email/`)

All files are `server-only`.

- **`transport.ts`** — builds the `nodemailer` transport from env; exports `isEmailConfigured(): boolean` (true iff `SMTP_HOST` set) and `sendMail({to, subject, html, text, attachments})`.
- **`layout.ts`** — the branded base HTML shell: table-based, fully inline-styled (email clients cannot use external CSS or CSS variables). Renders a dark card, the accent-colored CTA button, and the logo. Reads accent color + app title from `getAppSettings()`. Also provides the plain-text wrapper.
- **`render.ts`** — `${var}` substitution helper (mirrors the `renderCortexAnalytics` spirit); asserts no unresolved `${…}` remain.
- **`templates/password-reset.ts`** — EN/DE subject + body content. Variables: `userName`, `resetUrl`, `expiresMinutes`, `appTitle`.
- **`send.ts`** — `sendPasswordResetEmail({ user, resetUrl, locale })`: composes template + layout, embeds the logo as an **inline CID attachment** via the existing `readLogo` helper (falls back gracefully to no logo / bundled `/logo.png` reference if none is set), and calls `sendMail`.

**Branding-in-email note:** emails can't consume the app's CSS token system, so the
email layout is an independent, inline-styled component that *reads the same brand
values* (accent color, logo, title). It stays visually on-brand without sharing code
with the React UI.

**Extensibility:** a future email = a new file in `templates/` + a small `sendXxx`
function in `send.ts` reusing `layout.ts` and `render.ts`.

## Reset URL construction

`resetUrl = ${APP_BASE_URL}/reset-password?token=${token}` — built server-side from
the configured `APP_BASE_URL`, never from the request `Host`/`X-Forwarded-Host`
header (prevents password-reset link poisoning).

## UI

- **Login page** (`src/app/login/page.tsx`): add a "Forgot password?" link below the form, routing to `/forgot-password`. MOCA styling, i18n.
- **`/forgot-password`** (new public page): email input → posts to the forgot endpoint → shows a generic "If that email exists, we've sent a reset link" confirmation (enumeration-safe copy). Reuses the login page's MOCA glass-card visual language.
- **`/reset-password`** (new public page): reads `?token=`, probes validity on load, shows a new-password field (min 8) + confirm, posts to the reset endpoint, then routes to `/login` with a success hint. Handles expired/invalid token state.
- **`/admin/users`**: add a "Send reset email" action per user. Disabled with a tooltip/hint when email isn't configured. Shows a success/error toast.

## i18n

- **Page copy** (forgot/reset pages, admin button, toasts) → new keys in `src/lib/i18n.ts` (EN + DE, du-form), consistent with existing keys.
- **Email copy** (subjects/bodies) → server-side EN/DE map inside `templates/password-reset.ts`, so server-only text never enters the client bundle. Emails render in the app's configured default locale (`getAppSettings().locale`).

## Security

- Enumeration-safe forgot endpoint (uniform 200 + uniform UI copy).
- Tokens hashed at rest; single-use; 60-min TTL; prior tokens invalidated on new request.
- Successful reset invalidates every session for the user.
- Links built from `APP_BASE_URL` only.
- Passwords and plaintext tokens are never logged; hashes never returned to clients.
- New-password minimum length: 8 (matches the existing change-password rule).

### Superadmin exclusion
The superadmin password is re-hashed from `SUPERADMIN_PASSWORD` on **every server
boot** (`bootstrapSuperadmin`, intentional rotation model), and the existing
`PATCH /api/admin/users/[id]` route already refuses to change it. For consistency,
the reset flow **excludes the superadmin entirely**: self-service returns a uniform
200 but issues no token, and the admin send-reset route rejects a superadmin target
with a 400. Operators rotate the superadmin password via `SUPERADMIN_PASSWORD` +
restart; documented in `.env.example`/`CLAUDE.md`.

## Dependencies

Add `nodemailer` and `@types/nodemailer`. Small, no native build step, de-facto
standard for Node SMTP.

## Testing

**Unit**
- Token: hashing, expiry, single-use, "one active per user" invalidation.
- `forgot-password`: returns 200 for unknown email and issues no token; issues a token for a known email when configured.
- `reset-password`: rejects expired/used/invalid tokens; on success updates the hash and clears sessions.
- Template render: all variables substituted, no leftover `${…}`, EN and DE both render.
- `isEmailConfigured()` gating.

**Manual (Mailpit)**
- Configure local env for Mailpit (`SMTP_PORT=1025`), trigger a reset, view the
  branded email at `localhost:8025`, follow the link, set a new password, confirm
  old sessions are logged out and login works with the new password.

## Files (anticipated)

**New**
- `src/lib/email/transport.ts`, `layout.ts`, `render.ts`, `send.ts`, `templates/password-reset.ts`
- `src/lib/auth/reset-token.ts` (token create/verify/consume helpers)
- `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`
- `src/app/api/auth/forgot-password/route.ts`, `src/app/api/auth/reset-password/route.ts`
- `src/app/api/admin/users/[id]/send-reset/route.ts`
- `src/lib/db/migrations/0003_*.sql` (generated)
- Tests alongside the above.

**Modified**
- `src/lib/db/schema.ts` (new table)
- `src/middleware.ts` (public paths)
- `src/instrumentation.ts` (conditional SMTP/APP_BASE_URL validation)
- `src/lib/i18n.ts` (new keys)
- `src/app/login/page.tsx` (forgot link)
- `src/app/admin/users/*` (send-reset action)
- `.env.example`, `docker-compose.yml`, `CLAUDE.md` (docs)
- `package.json` (nodemailer)
```
