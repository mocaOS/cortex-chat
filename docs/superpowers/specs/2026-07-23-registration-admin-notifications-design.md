# Registration admin notifications — design

**Date:** 2026-07-23
**Status:** Approved (design), pending implementation plan

## Summary

Admins can maintain a free-form list of email addresses on `/admin/settings`.
Whenever a user self-registers and lands in the pending-approval queue, every
address on that list receives one notification email. An empty list means no one
is notified. As with all email in this app, the feature is inert unless SMTP is
configured.

## Goals

- Give admins a way to learn about pending registrations without polling the
  `/admin/users` registrations tab.
- Keep the recipient list independent of user accounts — any address works
  (shared ops inbox, alias, email-to-Slack hook, an admin's personal address).
- Reuse the existing email module, settings KV store, and feature gating; no new
  dependency, no schema migration.

## Non-goals

- No per-recipient preferences, digest batching, or unsubscribe flow (YAGNI —
  this is an admin-curated internal notification).
- No notification for admin-created users (those never enter the pending queue).
- No change to the approval or password-reset email flows.
- No new automated test framework (none exists in the project today).

## Interpretation

"All admins can manage a list of email addresses" is satisfied by putting a
single field on the existing `/admin/settings` page, which is already gated by
`requireAdmin()` (both `admin` and `superadmin` roles). The list is **free-form
text**, not derived from `users.role`. Empty list ⇒ no notifications, stated
explicitly in the requirement.

## Architecture

Trigger point is `POST /api/auth/register`
(`src/app/api/auth/register/route.ts`), which inserts a row into the
`registrations` table and today just returns `{ ok: true }`. After a successful
insert we send notifications, best-effort, to the configured recipients.

### 1. Storage — `src/lib/settings.ts`

New `app_settings` KV key `registrationNotifyEmails`, stored as a normalized,
newline-joined string, reusing the existing text-setting machinery (empty string
clears the key, identical to the other text settings).

Changes:
- Add `registrationNotifyEmails` to the `TEXT_KEYS` array.
- Add `registrationNotifyEmails: string` to the `AppSettings` interface.
- Export `DEFAULT_REGISTRATION_NOTIFY_EMAILS = ""`.
- Read it in `getAppSettings()` (`map.get("registrationNotifyEmails") || DEFAULT_...`).
- Add the key to the `setTextSettings` `Pick<...>` parameter type.
- Add a pure helper `parseNotifyRecipients(raw: string): string[]` — split on
  newlines and commas, trim, lowercase, drop blanks, dedupe. This is the single
  tokenizer used by both the send path and the API validator, so validation and
  delivery can never disagree about what counts as an entry.

Rationale for a KV string over a dedicated table: it is one admin-scoped config
value with no per-row metadata; a table would be over-engineering. This mirrors
the `cortexAnalyticsTemplate` precedent exactly.

### 2. Settings API — `src/app/api/admin/settings/route.ts`

- **PATCH body:** add
  `registrationNotifyEmails: z.string().max(4000).optional()` with a
  `.superRefine` that tokenizes the raw value with `parseNotifyRecipients`
  (newlines + commas), validates every token is a valid email address, and caps
  the count at 50, returning a 400 whose message names the offending value.
  Store the normalized `parseNotifyRecipients(...).join("\n")` form (already
  trimmed / lowercased / deduped) via `setTextSettings`, so the stored and
  echoed-back value is always clean. Empty string clears the key (no
  notifications).
- **`serialize()`:** return `registrationNotifyEmails`, and add
  `emailConfigured: isEmailConfigured()` so the UI can show an "email is off"
  hint.
- **GET `defaults`:** add `registrationNotifyEmails: ""`.

### 3. Email template — `src/lib/email/templates/registration-pending.ts` (new)

EN/DE builders, following the `account-approved.ts` shape (du-form German,
branded layout via `renderEmailLayout`, `emailButton` CTA). Content:

- Subject (EN): `New account awaiting approval — {appTitle}`;
  (DE): `Neue Registrierung wartet auf Freigabe — {appTitle}`.
- Body: a new account is awaiting approval; the **registrant's email address**
  (escaped via `escapeHtml`); a **"Review registrations"** button linking to
  `${APP_BASE_URL}/admin/users`.
- Vars interface: `{ registrantEmail, reviewUrl, appTitle, accentHex }`.

Email copy stays server-side in this template only — never added to `i18n.ts`
(per CLAUDE.md).

### 4. Sender — `src/lib/email/send.ts`

Add `sendRegistrationPendingNotification({ recipients, registrantEmail })`:

- Compose once (shared branding + locale from `getBranding()`).
- `reviewUrl = ${getAppBaseUrl()}/admin/users`.
- Deliver to **each recipient individually** through `deliverBrandedEmail`,
  wrapped in `Promise.allSettled` — one bad address never blocks the others, and
  the admin list is not exposed across recipients (no shared To/Cc). Rejected
  sends are captured to Sentry.

### 5. Trigger — `src/app/api/auth/register/route.ts`

After the successful `db.insert(registrations)` and before returning
`{ ok: true }`:

```
if (isEmailConfigured()) {
  const recipients = parseNotifyRecipients(getAppSettings().registrationNotifyEmails);
  if (recipients.length) {
    try {
      await sendRegistrationPendingNotification({ recipients, registrantEmail: email });
    } catch (err) {
      Sentry.captureException(err);
    }
  }
}
```

The registration is already committed, so a slow or failing SMTP only affects the
notification — never the registrant's success response and never a rollback.
Awaiting (rather than fire-and-forget) is chosen for reliability and consistency
with the existing approve route; the per-IP 60s cooldown already bounds how often
this path runs.

### 6. Settings UI — `src/app/admin/settings/page.tsx`

A new textarea field (one email per line) inside the existing form, following the
`cortexAnalyticsTemplate` field's structure:

- Uppercase micro-label, monospace textarea, hint line: "One email per line.
  Leave empty to disable. Notifications are sent whenever someone registers and
  is awaiting approval."
- When `emailConfigured` is false, a muted note that notifications require SMTP
  to be configured.
- Wired into the existing `load` / `savePatch` state round-trip (add state,
  include in the PATCH payload, hydrate from the response).

### 7. i18n — `src/lib/i18n.ts`

EN/DE keys for the field label, the hint, and the "email off" note. UI strings
only — email body copy lives in the template.

## Data flow

1. Admin edits the textarea on `/admin/settings` and saves → PATCH validates,
   normalizes, stores `registrationNotifyEmails` in `app_settings`.
2. A visitor submits `/register` → row inserted into `registrations`.
3. Register route reads + parses the recipient list; if SMTP is on and the list
   is non-empty, sends one branded email per recipient, best-effort.
4. Each recipient gets an email naming the registrant and linking to
   `/admin/users` to approve or reject.

## Edge cases

- **No SMTP:** `isEmailConfigured()` is false ⇒ nothing sent. Settings field
  stays editable, with a hint that it is inactive.
- **Empty list:** nothing sent.
- **Invalid entry on save:** 400 naming the value; nothing stored.
- **One bad recipient at send time:** `Promise.allSettled` isolates it; the rest
  still send; failure logged to Sentry.
- **Send failure of all recipients:** registration still succeeds; error logged.
- **Duplicate / mixed-case entries:** normalized away on save.
- **Registrant email in the body:** escaped; acceptable to expose to admins, who
  see it in the approval UI regardless.

## Feature gating summary

- Sending is entirely gated by `isEmailConfigured()` (SMTP_HOST set) — same gate
  as password-reset and approval emails.
- The setting itself is always visible to admins (they may pre-fill it before
  SMTP is wired), with an inline note when email is off.

## Verification (no test framework)

The project has no test harness, so verification is manual plus static checks:

- `tsc` / lint / `next build` clean.
- Against the documented local Mailpit SMTP (`SMTP_HOST=localhost`,
  `SMTP_PORT=1025`, web UI `:8025`, `APP_BASE_URL=http://localhost:3000`):
  - With two addresses listed, register a user → both receive the branded email;
    the "Review registrations" button opens `/admin/users`.
  - Empty list → no email.
  - Unset `SMTP_HOST` → no email, no error; field shows the "email off" hint.
  - Save an invalid entry (e.g. `not-an-email`) → 400, nothing stored.

## Files touched

- `src/lib/settings.ts` (modify)
- `src/app/api/admin/settings/route.ts` (modify)
- `src/app/api/auth/register/route.ts` (modify)
- `src/lib/email/send.ts` (modify)
- `src/lib/email/templates/registration-pending.ts` (new)
- `src/app/admin/settings/page.tsx` (modify)
- `src/lib/i18n.ts` (modify)

No schema migration. No new dependency.

## Acceptance criteria

- [ ] Admins can add/edit/remove notification recipients on `/admin/settings`,
      one email per line, and the value persists across reload.
- [ ] Invalid email entries are rejected on save with a clear message.
- [ ] A new self-registration sends one branded email to each listed recipient,
      naming the registrant and linking to `/admin/users`.
- [ ] An empty list sends nothing.
- [ ] No SMTP configured sends nothing and surfaces no error to the registrant.
- [ ] A send failure never blocks or rolls back the registration.
- [ ] EN and DE UI strings present; email renders in the app locale.
