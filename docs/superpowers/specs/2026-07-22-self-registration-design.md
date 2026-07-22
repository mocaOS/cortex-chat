# Self-registration with admin approval — design

Date: 2026-07-22
Status: approved

## Summary

Add a public signup page where unregistered people create an account with email +
password. Accounts start as **pending registrations** and cannot sign in. Admins
review them in a new **Registrations** tab on `/admin/users`, where they either
delete a registration or confirm it (picking the user's group in the confirm
dialog). Confirmation creates the real user, deletes the registration, and sends
a branded "account approved" email (when SMTP is configured). The whole feature
is gated by an env var, **default on**. Independently useful and shipped
alongside: an eye icon on every password field in the app that toggles
plain-text visibility.

## Decisions made during brainstorming

1. **Group assignment happens in the confirm dialog** — approving opens a modal
   with a group dropdown, so approved users are immediately functional (a user
   without a group can log in but cannot chat, since the group holds the
   backend chat key).
2. **Honest messages over strict enumeration-safety** — a pending user who logs
   in with correct credentials sees "awaiting approval"; signup with a taken
   email says "already registered". (The existing forgot-password flow remains
   strictly enumeration-safe; this feature deliberately trades a little of that
   for clarity, appropriate for a closed tool.)
3. **Pending registrations live in a separate `registrations` table**, not a
   status column on `users`. The `users` invariant "every row is a real
   account" holds, so no existing query (admin list, analytics, forgot-password,
   send-reset, group views) changes or can regress. Fails closed for future
   features. Cost: email uniqueness across both tables is enforced in app code.

## 1. Feature gate

- New env var `ENABLE_REGISTRATION`. Enabled unless explicitly set to `false`
  or `0` (case-insensitive). **Default on.**
- Server helper `isRegistrationEnabled()` in a new `src/lib/registration.ts`,
  read at request time. No boot validation — every value is valid.
- Client exposure: `registrationEnabled: boolean` added to the `/api/config`
  payload (same pattern as `emailConfigured`).
- When **off**:
  - Login page hides the "Create account" link.
  - `/register` redirects to `/login`.
  - `POST /api/auth/register` returns 404.
  - The admin Registrations tab **stays visible** so leftover pending rows can
    still be confirmed/deleted. The gate stops new signups only.
- SMTP is orthogonal: registration + approval work without `SMTP_HOST`; the
  approval email is simply skipped (existing email feature-gate convention).

## 2. Data model

New table `registrations` (Drizzle schema in `src/lib/db/schema.ts`, migration
`0004` generated via `npm run db:generate`, applied on boot like the others):

| column         | type    | notes                                  |
| -------------- | ------- | -------------------------------------- |
| `id`           | text pk | `newId()`                              |
| `email`        | text    | unique index, stored lowercased/trimmed |
| `passwordHash` | text    | argon2id via existing `hashPassword()` |
| `createdAt`    | integer | unixepoch ms default, like other tables |

`users` is untouched. Uniqueness rules in app code:

- Signup rejects an email that exists in `users` **or** `registrations` (409).
- Approval re-checks `users` inside its transaction (an admin may have created
  that email manually in the meantime) and 409s without touching the row.
- Admin user-create (`POST /api/admin/users`) is **not** changed; a collision
  with a pending registration surfaces at approval time as that 409, and the
  admin resolves it by deleting the registration.

## 3. Register page + API

### Page `/register` (public)

- Added to middleware `PUBLIC_PATHS` (page + API route).
- Same MOCA glass-card composition as `/login` (accent glow, blur card): logo,
  email field, password field, confirm-password field, submit button.
- **Live password-match indicator**: rendered once both password fields are
  non-empty — "Passwords match" in `var(--success)` with a check icon, or
  "Passwords don't match" in `var(--destructive)`. Submit stays disabled until:
  valid email, password ≥ 8 chars (same floor as admin user-create), fields
  match.
- Both password fields use the new eye-toggle component (section 8).
- Success replaces the card content: "Registration received — an admin needs to
  approve your account before you can sign in." + back-to-login link.
- Failure states surface inline like the login page (409 → "already
  registered", 429 → try-again-later, generic otherwise), localized.
- Login page gains a "Create account" link next to "Forgot password?", gated by
  `registrationEnabled` from config.

### `POST /api/auth/register` (public)

- zod body: `email` (email), `password` (min 8). Email normalized
  lowercase/trim.
- Responses: 404 feature off · 400 invalid payload · 409 email taken (either
  table) · 429 per-IP cooldown · 200 `{ok: true}` after insert.
- Light anti-spam: in-memory per-IP cooldown, 60s between registrations from
  one IP (spiritual sibling of the forgot-password 60s resend cooldown; resets
  on process restart, which is fine for a spam floor).

## 4. Pending users at login

`POST /api/auth/login`, only in the branch where no `users` row matched:

- Look up `registrations` by email; verify password against its hash.
- Match → 401 with `{error: "Your account is awaiting approval.", code:
  "pendingApproval"}`. The client maps `code` to a localized message (the
  existing client renders `data.error` verbatim; it now checks `code` first so
  DE users get German).
- No match / wrong password → the usual generic 401. Outsiders cannot probe
  whether an email is pending without knowing its password.
- `login_events` keeps logging these attempts as failures (userId null),
  unchanged.

## 5. Admin UI: tabs on /admin/users

- Lift the local underline `Tabs` component from the admin analytics page
  (`src/app/admin/page.tsx`) into `src/components/admin/ui.tsx`; both pages use
  the shared one (targeted improvement, no behavior change).
- **Tab "Users"** (default): the existing table and `UserForm` modal,
  unchanged.
- **Tab "Registrations"**: label carries the pending count when > 0 —
  "Registrations (3)". Columns: email, registered date. Actions per row:
  **Confirm** (primary) and **Delete** (danger, native `confirm()` like the
  existing user delete).
- Both lists are fetched in parallel on page mount (registrations list is
  small); the tab badge derives from the loaded list.
- **Confirm dialog** (reuses `Modal`): shows the registration's email, a group
  dropdown identical to the user form ("No group" option + all groups,
  defaulting to "No group"), and a hint that the group determines chat access.
  Approved users always get role `user`.
- Access: `requireAdmin` (admin + superadmin), consistent with existing user
  management on this page.

## 6. Admin API

All under `requireAdmin`, zod-validated:

- `GET /api/admin/registrations` → `{registrations: [{id, email, createdAt}]}`
- `POST /api/admin/registrations/[id]/approve`, body `{groupId: string | null}`
  - Transaction: re-check email absent from `users` (else 409, registration
    left intact) → insert `users` row (role `user`, chosen `groupId`,
    `passwordHash` copied) → delete registration.
  - After commit: send approval email **best-effort** when SMTP configured.
    Response `{ok: true, emailSent: boolean}`; the UI shows "approved, but the
    email could not be sent" when `emailSent` is false. Email failure never
    rolls back an approval.
  - 404 for an unknown registration id.
- `DELETE /api/admin/registrations/[id]` → deletes the row, `{ok: true}`; 404
  unknown id.

## 7. Approval email

- New template `src/lib/email/templates/account-approved.ts` mirroring
  `password-reset.ts` exactly: same `ComposedEmail` shape, EN + DE builders,
  `escapeHtml`, `emailButton`.
  - Subject EN: `Your {appTitle} account has been approved`
  - Subject DE: `Dein {appTitle}-Konto wurde freigeschaltet`
  - Body: account approved, you can now sign in with your email and password;
    button "Sign in" / "Jetzt anmelden" linking `${APP_BASE_URL}/login`.
- `sendAccountApprovedEmail({to, userName})` in `src/lib/email/send.ts`. The
  branded assembly currently inlined in `sendPasswordResetEmail` (app settings
  → locale/accent hex, logo CID attachment for PNG/JPEG, `renderEmailLayout`,
  `sendMail`) is refactored into one shared internal helper both senders use.
- `userName` falls back to the email when username is blank (registrations
  collect no username, so v1 always uses the email).
- Locale from app settings; German copy in du-form; email copy stays server-side
  (never in `i18n.ts`), per convention.

## 8. Password visibility toggle (all password fields)

- Shared component with a right-aligned icon button inside the field toggling
  the input `type` between `password` and `text`.
  - Inline SVG Eye / EyeOff (Lucide paths, 1.5px stroke, `currentColor`, 16px)
    — lucide-react is not installed; inline SVG is the repo convention.
  - Localized `aria-label` ("Show password" / "Hide password"),
    `type="button"` so it never submits forms.
  - Per-field state, defaults to hidden, no persistence.
- Two flavors matching the two existing input styles:
  - `src/components/PasswordInput.tsx` for public pages (replicates the raw
    input + inline CSS-var styling + focus-ring handlers used on login).
  - A password-capable variant of `Input` in `src/components/admin/ui.tsx` for
    admin forms (label wrapper preserved).
- Retrofit all 8 fields: login (1) · register (2, new) · reset-password (2) ·
  profile (2) · admin user form (1).

## 9. i18n

New EN/DE keys in `src/lib/i18n.ts` (German in du-form, product terms in
English): register page strings (title, labels, CTA, match/no-match, success
state, error states), "Create account" login link, pending-approval login
message, admin tab labels, registrations table headers, confirm-dialog
title/hint/buttons, approved/email-failed/delete feedback, eye-toggle aria
labels.

## 10. Error handling summary

| Endpoint | Cases |
| --- | --- |
| `POST /api/auth/register` | 400 invalid · 404 feature off · 409 taken · 429 IP cooldown · 200 ok |
| `POST /api/auth/login` | adds 401 `code: pendingApproval` (correct pending credentials only) |
| `POST .../registrations/[id]/approve` | 404 unknown id · 409 email taken by real user · 200 `{emailSent}` |
| `DELETE .../registrations/[id]` | 404 unknown id · 200 ok |

## 11. Verification

No test infrastructure exists in this repo (no test script/files); verification
is `npm run typecheck` plus a manual checklist against a dev server with
Mailpit (`SMTP_HOST=localhost`, `SMTP_PORT=1025`):

1. Signup happy path → success card; row appears in Registrations tab (count
   badge).
2. Signup with taken email (users + registrations) → 409 message.
3. Pending login with correct password → "awaiting approval"; wrong password →
   generic error.
4. Confirm with a group → user appears in Users tab with group; registration
   gone; approval email in Mailpit (EN and DE locale); login now works.
5. Confirm when SMTP down → approved with "email could not be sent" notice.
6. Delete registration → row gone; that email can register again.
7. `ENABLE_REGISTRATION=false` → no login link, `/register` redirects, API
   404s, Registrations tab still manageable.
8. Eye toggle shows/hides on all 8 password fields; aria-labels localized.
9. `npm run typecheck` clean.

## Out of scope (YAGNI)

Admin notification email on new signups · email verification of registrants ·
captcha · password reset for pending registrations (admin deletes the row, the
person re-registers) · analytics/usage events for signups · username collection
at signup.
