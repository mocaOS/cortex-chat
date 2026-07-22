# Self-Registration with Admin Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Env-gated public signup (`/register`) whose pending registrations are approved (with a group picked at approval time) or deleted from a new Registrations tab on `/admin/users`, with a branded approval email — plus a show/hide eye toggle on every password field in the app.

**Architecture:** Pending signups live in a new `registrations` SQLite table, fully separate from `users` (every `users` row stays a real, sign-in-capable account — no existing query changes). Approval is one transaction (insert user + delete registration) followed by a best-effort email that never rolls back the approval. The feature flag `ENABLE_REGISTRATION` (default ON) flows server → `/api/config` → client exactly like the existing `emailConfigured` flag.

**Tech Stack:** Next.js 16 App Router (route handlers, `"use client"` pages), Drizzle ORM + better-sqlite3, zod, `@node-rs/argon2`, nodemailer, hand-rolled i18n (`src/lib/i18n.ts`), MOCA design tokens (CSS vars), inline Lucide-path SVGs.

**Spec:** `docs/superpowers/specs/2026-07-22-self-registration-design.md` (approved).

## Global Constraints

- **No test infrastructure exists in this repo** (no test runner, no test files — verified). Every task's verification is: `npm run typecheck` (must be clean) + the concrete runtime checks listed in the task. Do not add a test framework.
- Dev server for runtime checks: `npm run dev` (http://localhost:3000). It needs a `.env` with `BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` set (boot-validated). Email checks additionally need Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_FROM="Cortex Chat <no-reply@example.com>"`, `APP_BASE_URL=http://localhost:3000` — Mailpit web UI at http://localhost:8025.
- `ENABLE_REGISTRATION` is server-only. **Never** prefix it `NEXT_PUBLIC_` (compile-time inlining would freeze it; runtime config rides `/api/config`).
- Every new API route file declares `export const dynamic = "force-dynamic";`.
- Passwords: hash only via `hashPassword()` / verify via `verifyPassword()` from `src/lib/auth/password.ts`. Never log or return a hash.
- Colors ONLY via existing CSS vars (`var(--accent)`, `var(--success)`, `var(--destructive)`, `var(--fg1)`, `var(--fg2)`, `var(--bg)`, `var(--input)`, `var(--ring)`, `var(--border)`). No new colors. Icons are inline SVGs (Lucide outline paths, `currentColor`) — lucide-react is NOT installed; do not add it.
- UI copy: sentence case, no hype. German uses du-form; product terms stay English. All user-visible strings go through `t("key")` — both `en` and `de` blocks in `src/lib/i18n.ts` must define every key (they mirror each other).
- Email copy lives ONLY in `src/lib/email/templates/` (server-side), never in `i18n.ts`.
- End every commit message with this trailer (blank line before it):
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Feature gate + config plumbing

**Files:**
- Create: `src/lib/registration.ts`
- Modify: `src/lib/config.ts` (ClientConfig interface + fallback)
- Modify: `src/app/api/config/route.ts`
- Modify: `src/app/layout.tsx`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isRegistrationEnabled(): boolean` (server-only, `src/lib/registration.ts`); `ClientConfig.registrationEnabled: boolean` available client-side via `getConfig()` / `getCachedConfig()`. Tasks 5, 7 rely on both.

- [ ] **Step 1: Create the server-side gate helper**

Create `src/lib/registration.ts`:

```ts
import "server-only";

// Self-registration feature gate. Default ON — disabled only when
// ENABLE_REGISTRATION is explicitly set to "false" or "0" (case-insensitive).
export function isRegistrationEnabled(): boolean {
  const raw = (process.env.ENABLE_REGISTRATION ?? "").trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}
```

- [ ] **Step 2: Add the flag to ClientConfig**

In `src/lib/config.ts`, the interface currently ends with:

```ts
  emailConfigured: boolean;
  maxUploadBytes: number;
}
```

Change to:

```ts
  emailConfigured: boolean;
  registrationEnabled: boolean;
  maxUploadBytes: number;
}
```

And in the same file's fetch-failure fallback object (inside `getConfig()`), the lines:

```ts
      emailConfigured: false,
      maxUploadBytes: MAX_UPLOAD_BYTES,
```

become:

```ts
      emailConfigured: false,
      registrationEnabled: false,
      maxUploadBytes: MAX_UPLOAD_BYTES,
```

(Fallback is `false`: it only applies when `/api/config` itself is unreachable, and hiding the register link is the safe cosmetic default.)

- [ ] **Step 3: Emit the flag from /api/config**

In `src/app/api/config/route.ts`, add the import:

```ts
import { isRegistrationEnabled } from "@/lib/registration";
```

and in the returned JSON object change:

```ts
    emailConfigured: isEmailConfigured(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
```

to:

```ts
    emailConfigured: isEmailConfigured(),
    registrationEnabled: isRegistrationEnabled(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
```

- [ ] **Step 4: Seed the flag in the server-rendered layout**

In `src/app/layout.tsx`, add the import:

```ts
import { isRegistrationEnabled } from "@/lib/registration";
```

and in the `initialConfig` object change:

```ts
    emailConfigured: isEmailConfigured(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
```

to:

```ts
    emailConfigured: isEmailConfigured(),
    registrationEnabled: isRegistrationEnabled(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
```

(`ConfigBootstrap` types its prop as `ClientConfig`, so Step 2 makes this mandatory — typecheck fails until this step is done.)

- [ ] **Step 5: Document the env var**

Append to the end of `.env.example`:

```
# --- Self-registration (optional) ---------------------------------------------
# Public /register page where people sign up with email + password. New
# registrations are pending until an admin approves them on /admin/users
# (Registrations tab). Default ON — set to false to disable new signups
# (existing pending registrations stay manageable in the admin UI).

# ENABLE_REGISTRATION=true
```

In `docker-compose.yml`, after the line:

```yaml
      APP_BASE_URL: ${APP_BASE_URL:-}
```

add:

```yaml
      # Self-registration (default on; set "false" to disable the /register page).
      ENABLE_REGISTRATION: ${ENABLE_REGISTRATION:-}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no output errors.

- [ ] **Step 7: Runtime verify**

With the dev server running (`npm run dev`):

Run: `curl -s http://localhost:3000/api/config | grep -o '"registrationEnabled":[a-z]*'`
Expected: `"registrationEnabled":true`

Stop the dev server, restart as `ENABLE_REGISTRATION=false npm run dev`, repeat the curl.
Expected: `"registrationEnabled":false`

Restart the dev server normally (flag unset) before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/registration.ts src/lib/config.ts src/app/api/config/route.ts src/app/layout.tsx .env.example docker-compose.yml
git commit -m "feat: ENABLE_REGISTRATION feature gate wired through config

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `registrations` table (schema + migration)

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create (generated): `src/lib/db/migrations/0004_*.sql` + meta updates

**Interfaces:**
- Consumes: nothing new.
- Produces: `registrations` Drizzle table (columns `id`, `email`, `passwordHash`, `createdAt`) and `export type Registration = typeof registrations.$inferSelect;`. Tasks 5, 6, 9 import `registrations` from `@/lib/db/schema`.

- [ ] **Step 1: Add the table to the schema**

In `src/lib/db/schema.ts`, directly after the `passwordResetTokens` table definition (it ends with the `)` closing the index callback, before `export const loginEvents`), insert:

```ts
// Self-registration requests awaiting admin approval. Deliberately a separate
// table: every `users` row remains a real, sign-in-capable account, so no
// existing users query needs a "pending" filter. Approval moves the row into
// `users` in one transaction (see /api/admin/registrations/[id]/approve).
export const registrations = sqliteTable("registrations", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});
```

And at the bottom of the file, alongside the other type exports (after `export type LoginEvent = ...`), add:

```ts
export type Registration = typeof registrations.$inferSelect;
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: prints a new migration file `src/lib/db/migrations/0004_<generated-name>.sql` (drizzle-kit picks a random codename). Open it and confirm it contains exactly a `CREATE TABLE \`registrations\`` with the four columns and a `CREATE UNIQUE INDEX \`registrations_email_unique\`` on `email` — nothing touching other tables. If other tables appear in the diff, stop: the schema edit was wrong.

- [ ] **Step 3: Apply the migration locally**

Run: `npm run db:migrate`
Expected: exits 0.

Run: `sqlite3 ./data/cortex-chat.db ".schema registrations"`
Expected output (formatting may differ slightly):

```
CREATE TABLE `registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX `registrations_email_unique` ON `registrations` (`email`);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/
git commit -m "feat: registrations table for pending self-signups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: i18n strings (EN + DE)

**Files:**
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the translation keys below, used by Tasks 4, 7, 10 via `t("key")` / `t("key", { email })`. The existing key `resetPasswordMismatch` ("Passwords don't match." / "Die Passwörter stimmen nicht überein.") is deliberately REUSED for the register page mismatch line — do not add a duplicate key for it.

- [ ] **Step 1: Add the English keys**

In `src/lib/i18n.ts`, inside the `en` object, find the line:

```ts
    resetPasswordCheckingLink: "Checking link…",
```

and insert directly after it:

```ts

    // Self-registration
    createAccount: "Create account",
    registerHeading: "Create your account",
    registerPasswordLabel: "Password (min. 8 characters)",
    registerConfirmLabel: "Confirm password",
    registerSubmit: "Sign up",
    registerSubmitting: "Signing up…",
    registerSuccess:
      "Registration received — an admin needs to approve your account before you can sign in.",
    registerEmailTaken: "This email is already registered.",
    registerRateLimited: "Please wait a moment before trying again.",
    registerFailed: "Registration failed. Please try again.",
    passwordsMatch: "Passwords match",
    loginPendingApproval:
      "Your account is awaiting approval by an administrator.",
    showPassword: "Show password",
    hidePassword: "Hide password",
    usersTab: "Users",
    registrationsTab: "Registrations",
    registrationsEmpty: "No pending registrations.",
    tableRegistered: "Registered",
    confirmRegistrationTitle: "Approve {email}",
    confirmRegistrationHint:
      "The group determines which collections the new user can chat with. Without a group, they can sign in but can't chat.",
    confirmRegistration: "Confirm",
    confirmingRegistration: "Confirming…",
    registrationApproved: "{email} has been approved.",
    registrationApprovedNoEmail:
      "Approved — but the confirmation email could not be sent.",
    deleteRegistrationConfirm: "Delete the registration for {email}?",
```

- [ ] **Step 2: Add the German keys**

In the `de` object, find the line:

```ts
    resetPasswordCheckingLink: "Prüfe Link…",
```

and insert directly after it:

```ts

    // Selbstregistrierung
    createAccount: "Konto erstellen",
    registerHeading: "Konto erstellen",
    registerPasswordLabel: "Passwort (mind. 8 Zeichen)",
    registerConfirmLabel: "Passwort bestätigen",
    registerSubmit: "Registrieren",
    registerSubmitting: "Registriere…",
    registerSuccess:
      "Registrierung eingegangen — ein Admin muss dein Konto freischalten, bevor du dich anmelden kannst.",
    registerEmailTaken: "Diese E-Mail-Adresse ist bereits registriert.",
    registerRateLimited:
      "Bitte warte einen Moment, bevor du es erneut versuchst.",
    registerFailed: "Registrierung fehlgeschlagen. Bitte versuche es erneut.",
    passwordsMatch: "Passwörter stimmen überein",
    loginPendingApproval:
      "Dein Konto wartet auf die Freischaltung durch einen Administrator.",
    showPassword: "Passwort anzeigen",
    hidePassword: "Passwort verbergen",
    usersTab: "Benutzer",
    registrationsTab: "Registrierungen",
    registrationsEmpty: "Keine offenen Registrierungen.",
    tableRegistered: "Registriert",
    confirmRegistrationTitle: "{email} freischalten",
    confirmRegistrationHint:
      "Die Gruppe bestimmt, mit welchen Collections der neue Benutzer chatten kann. Ohne Gruppe ist die Anmeldung möglich, aber kein Chat.",
    confirmRegistration: "Bestätigen",
    confirmingRegistration: "Bestätige…",
    registrationApproved: "{email} wurde freigeschaltet.",
    registrationApprovedNoEmail:
      "Freigeschaltet — aber die Bestätigungs-E-Mail konnte nicht gesendet werden.",
    deleteRegistrationConfirm: "Registrierung von {email} löschen?",
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. (The `de` block's type mirrors `en` — a missing or extra key on either side fails here.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat: EN/DE strings for self-registration and password toggle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Password visibility toggle on all existing fields

**Files:**
- Create: `src/components/PasswordVisibility.tsx`
- Create: `src/components/PasswordInput.tsx`
- Modify: `src/components/admin/ui.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/reset-password/page.tsx`
- Modify: `src/app/profile/page.tsx`
- Modify: `src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: i18n keys `showPassword` / `hidePassword` (Task 3).
- Produces:
  - `src/components/PasswordVisibility.tsx`: named exports `EyeIcon()`, `EyeOffIcon()`, `VisibilityToggle({ visible: boolean; onToggle: () => void })`.
  - `src/components/PasswordInput.tsx`: default export `PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">)` — public-page flavor (no label). Task 7's register page uses this.
  - `src/components/admin/ui.tsx`: named export `PasswordInput` (forwardRef, `Omit<InputHTMLAttributes, "type"> & { label?: string }`) — admin flavor with the label wrapper.

- [ ] **Step 1: Create the shared toggle + icons**

Create `src/components/PasswordVisibility.tsx`:

```tsx
"use client";

import { t } from "@/lib/i18n";

// Inline Lucide "eye" / "eye-off" outline paths — lucide-react is not a
// dependency; inline SVGs with currentColor are the repo convention.
export function EyeIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

// The eye button that sits inside a relative-positioned field wrapper.
export function VisibilityToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? t("hidePassword") : t("showPassword")}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-[var(--radius-sm)] transition-colors"
      style={{ color: "var(--fg2)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--fg1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--fg2)";
      }}
    >
      {visible ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}
```

- [ ] **Step 2: Create the public-page PasswordInput**

Create `src/components/PasswordInput.tsx`:

```tsx
"use client";

import { useState } from "react";
import { VisibilityToggle } from "./PasswordVisibility";

// Password field for the public auth pages (login / register / reset) —
// visually identical to their raw inputs, plus the show/hide eye toggle.
// `type` is owned by the component; everything else passes through.
export default function PasswordInput(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
) {
  const [visible, setVisible] = useState(false);
  const { className = "", ...rest } = props;
  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={`w-full rounded-[var(--radius)] pl-3 pr-10 py-2.5 text-[13px] outline-none border transition-colors ${className}`}
        style={{
          background: "var(--bg)",
          borderColor: "var(--input)",
          color: "var(--fg1)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--ring)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--input)";
        }}
      />
      <VisibilityToggle
        visible={visible}
        onToggle={() => setVisible((v) => !v)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add the admin-flavor PasswordInput to the admin UI kit**

In `src/components/admin/ui.tsx`:

Change the first import line from:

```ts
import { forwardRef } from "react";
```

to:

```ts
import { forwardRef, useState } from "react";
import { VisibilityToggle } from "../PasswordVisibility";
```

Then insert directly after the closing `});` of the existing `Input` component (before `export function Textarea`):

```tsx
// Password variant of Input: same label + styling, plus the show/hide eye
// toggle. `type` is owned by the component.
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: string }
>(function PasswordInput({ label, className = "", ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block space-y-1.5">
      {label && <span className={fieldLabel}>{label}</span>}
      <div className="relative">
        <input
          ref={ref}
          {...props}
          type={visible ? "text" : "password"}
          style={{
            background: "var(--bg)",
            borderColor: "var(--input)",
            color: "var(--fg1)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--ring)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--input)";
          }}
          className={`${inputBase} pr-10 placeholder:text-[var(--fg3)] ${className}`}
        />
        <VisibilityToggle
          visible={visible}
          onToggle={() => setVisible((v) => !v)}
        />
      </div>
    </label>
  );
});
```

- [ ] **Step 4: Retrofit the login page**

In `src/app/login/page.tsx`:

Add the import (after the other `@/` imports):

```ts
import PasswordInput from "@/components/PasswordInput";
```

Replace the entire password `<input …/>` element (the one with `type="password"`, `value={password}`, `autoComplete="current-password"` and its inline style/focus/blur handlers — keep the surrounding `<div className="space-y-1.5">` and `<label>` untouched) with:

```tsx
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
```

- [ ] **Step 5: Retrofit the reset-password page**

In `src/app/reset-password/page.tsx`:

Add the import:

```ts
import PasswordInput from "@/components/PasswordInput";
```

Replace the first password `<input …/>` (the one with `value={password}`, `autoFocus`) with:

```tsx
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                autoFocus
              />
```

Replace the second password `<input …/>` (the one with `value={confirm}`) with:

```tsx
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
```

(Labels above them stay as they are.)

- [ ] **Step 6: Retrofit the profile page**

In `src/app/profile/page.tsx`:

Change the admin-ui import from:

```ts
import { Button, ErrorBanner, Input } from "@/components/admin/ui";
```

to:

```ts
import { Button, ErrorBanner, Input, PasswordInput } from "@/components/admin/ui";
```

In the Password section, replace:

```tsx
              <Input
                label={t("currentPassword")}
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <Input
                label={t("newPasswordMin")}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
```

with:

```tsx
              <PasswordInput
                label={t("currentPassword")}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <PasswordInput
                label={t("newPasswordMin")}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
```

- [ ] **Step 7: Retrofit the admin user form**

In `src/app/admin/users/page.tsx`:

Change the admin-ui import block from:

```ts
import {
  Button,
  ErrorBanner,
  Input,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/ui";
```

to:

```ts
import {
  Button,
  ErrorBanner,
  Input,
  PasswordInput,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/ui";
```

In `UserForm`, replace:

```tsx
            <Input
              label={user ? t("newPasswordLeaveBlank") : t("password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={user ? "•••••••" : ""}
              minLength={user && !password ? 0 : 8}
              required={!user}
            />
```

with:

```tsx
            <PasswordInput
              label={user ? t("newPasswordLeaveBlank") : t("password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={user ? "•••••••" : ""}
              minLength={user && !password ? 0 : 8}
              required={!user}
            />
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 9: Runtime verify**

With the dev server running, check in the browser:
1. `/login` — eye icon inside the password field; clicking reveals the typed text, aria-label toggles, icon switches to eye-off; field keeps focus styling.
2. `/reset-password` renders its form only with a valid token — if none is handy, skip its visual check: both of its fields use the exact `PasswordInput` component verified on `/login`, and Task 11's checklist covers it end-to-end via a real reset link.
3. `/profile` (logged in) — both password fields have the toggle, labels intact.
4. `/admin/users` → New User — password field has the toggle inside the modal.

- [ ] **Step 10: Commit**

```bash
git add src/components/PasswordVisibility.tsx src/components/PasswordInput.tsx src/components/admin/ui.tsx src/app/login/page.tsx src/app/reset-password/page.tsx src/app/profile/page.tsx src/app/admin/users/page.tsx
git commit -m "feat: show/hide eye toggle on all password fields

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `POST /api/auth/register` + public paths

**Files:**
- Create: `src/app/api/auth/register/route.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `registrations` table (Task 2), `isRegistrationEnabled()` (Task 1), `hashPassword` (`src/lib/auth/password.ts`), `getRequestMeta` (`src/lib/auth/session.ts`), `newId` (`src/lib/auth/crypto.ts`).
- Produces: `POST /api/auth/register` accepting `{email: string, password: string}`; responses 200 `{ok:true}` · 400 · 404 (feature off) · 409 (taken) · 429 (IP cooldown). Task 7's register page calls it. Also registers `/register` + `/api/auth/register` as public paths (Task 7 creates the page).

- [ ] **Step 1: Add public paths to the middleware**

In `src/middleware.ts`, change:

```ts
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/config",
  "/api/branding/logo",
]);
```

to:

```ts
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/register",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/register",
  "/api/config",
  "/api/branding/logo",
]);
```

- [ ] **Step 2: Create the register route**

Create `src/app/api/auth/register/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { registrations, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { getRequestMeta } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { isRegistrationEnabled } from "@/lib/registration";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// In-memory per-IP cooldown — a spam floor for this unauthenticated write
// endpoint (same spirit as the forgot-password 60s resend cooldown). Resets on
// restart, and is skipped when no client IP is attributable (e.g. local dev
// without a proxy) — the unique email index is the real integrity guard.
const lastRegistrationByIp = new Map<string, number>();
const COOLDOWN_MS = 60_000;

export async function POST(request: Request) {
  if (!isRegistrationEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { ip } = await getRequestMeta();
  if (ip && Date.now() - (lastRegistrationByIp.get(ip) ?? 0) < COOLDOWN_MS) {
    return NextResponse.json(
      { error: "Please wait before trying again." },
      { status: 429 }
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existingUser = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();
  const existingRegistration = db
    .select()
    .from(registrations)
    .where(eq(registrations.email, email))
    .get();
  if (existingUser || existingRegistration) {
    return NextResponse.json(
      { error: "This email is already registered." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    db.insert(registrations).values({ id: newId(), email, passwordHash }).run();
  } catch {
    // Unique-index race between the check above and the insert.
    return NextResponse.json(
      { error: "This email is already registered." },
      { status: 409 }
    );
  }

  if (ip) {
    if (lastRegistrationByIp.size > 1000) lastRegistrationByIp.clear();
    lastRegistrationByIp.set(ip, Date.now());
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Runtime verify**

With the dev server running:

```bash
curl -s -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"email":"pending@example.com","password":"password123"}'
```
Expected: `{"ok":true}`

Repeat the same command.
Expected: `{"error":"This email is already registered."}` (HTTP 409 — local curl sends no `x-forwarded-for`, so the IP cooldown is skipped and the duplicate check answers).

```bash
curl -s -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"email":"nope","password":"short"}'
```
Expected: `{"error":"Invalid payload"}`

```bash
sqlite3 ./data/cortex-chat.db "SELECT email FROM registrations;"
```
Expected: `pending@example.com`

Feature-off check: restart dev as `ENABLE_REGISTRATION=false npm run dev`, POST again with a fresh email → `{"error":"Not found"}` (404). Restart normally afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/register/route.ts src/middleware.ts
git commit -m "feat: public POST /api/auth/register creating pending registrations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Pending-approval answer at login

**Files:**
- Modify: `src/app/api/auth/login/route.ts`

**Interfaces:**
- Consumes: `registrations` table (Task 2), `verifyPassword` (already imported in this file).
- Produces: `POST /api/auth/login` now returns 401 `{error: "Your account is awaiting approval.", code: "pendingApproval"}` when the email belongs to a pending registration AND the password verifies. Task 7's login page maps `code` to a localized message.

- [ ] **Step 1: Extend the failed-login branch**

In `src/app/api/auth/login/route.ts`:

Change the schema import line from:

```ts
import { loginEvents, usageEvents, users } from "@/lib/db/schema";
```

to:

```ts
import { loginEvents, registrations, usageEvents, users } from "@/lib/db/schema";
```

Replace the block:

```ts
  if (!ok || !user) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }
```

with:

```ts
  if (!ok || !user) {
    // Self-registered but not yet approved? Only reveal the pending status
    // when the password matches — otherwise outsiders could probe emails.
    if (!user) {
      const pending = db
        .select()
        .from(registrations)
        .where(eq(registrations.email, email))
        .get();
      if (
        pending &&
        (await verifyPassword(pending.passwordHash, parsed.data.password))
      ) {
        return NextResponse.json(
          {
            error: "Your account is awaiting approval.",
            code: "pendingApproval",
          },
          { status: 401 }
        );
      }
    }
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }
```

(The `login_events` insert above this block is untouched — pending attempts keep being recorded as failures with `userId: null`.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Runtime verify**

With the dev server running and the `pending@example.com` registration from Task 5 present:

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"pending@example.com","password":"password123"}'
```
Expected: `{"error":"Your account is awaiting approval.","code":"pendingApproval"}`

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"pending@example.com","password":"wrongpassword"}'
```
Expected: `{"error":"Invalid email or password"}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "feat: login answers pendingApproval for unapproved registrations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `/register` page + login-page link and pending message

**Files:**
- Create: `src/app/register/page.tsx`
- Create: `src/app/register/RegisterForm.tsx`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/register` (Task 5), `code: "pendingApproval"` (Task 6), `PasswordInput` default export (Task 4), `ClientConfig.registrationEnabled` (Task 1), i18n keys (Task 3), `isRegistrationEnabled()` (Task 1).
- Produces: public page `/register` (server-gated redirect when the feature is off) and a "Create account" link on `/login`.

- [ ] **Step 1: Create the server-gated page wrapper**

Create `src/app/register/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { isRegistrationEnabled } from "@/lib/registration";
import RegisterForm from "./RegisterForm";

export const dynamic = "force-dynamic";

// Server-side gate: with the feature off, /register does not exist — bounce to
// login without ever rendering the form (no client-side flash).
export default function RegisterPage() {
  if (!isRegistrationEnabled()) redirect("/login");
  return <RegisterForm />;
}
```

- [ ] **Step 2: Create the registration form**

Create `src/app/register/RegisterForm.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import PasswordInput from "@/components/PasswordInput";

export default function RegisterForm() {
  useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState(
    () => getCachedConfig()?.logoUrl || "/logo.png"
  );
  const [ready, setReady] = useState(() => !!getCachedConfig());

  useEffect(() => {
    getConfig()
      .then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.png"))
      .finally(() => setReady(true));
  }, []);

  const matches = password === confirm;
  const canSubmit =
    !loading && email.length > 0 && password.length >= 8 && matches;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(
          res.status === 409
            ? t("registerEmailTaken")
            : res.status === 429
              ? t("registerRateLimited")
              : t("registerFailed")
        );
        setLoading(false);
        return;
      }
      setDone(true);
    } catch {
      setError(t("registerFailed"));
      setLoading(false);
    }
  }

  if (!ready) {
    return <div className="h-dvh" style={{ background: "var(--bg)" }} />;
  }

  const fieldLabelStyle: React.CSSProperties = { color: "var(--fg2)" };

  return (
    <div
      className="h-dvh flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Soft accent glow at 15% — MOCA hero signature */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "720px",
          height: "480px",
          background:
            "radial-gradient(circle, color-mix(in oklch, var(--accent) 15%, transparent) 0%, transparent 60%)",
          filter: "blur(40px)",
        }}
      />

      <div
        className="w-full max-w-sm rounded-[var(--radius-xl)] p-7 space-y-5 relative border"
        style={{
          background: "oklch(0.17 0 0 / 0.75)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div className="flex items-center justify-center pb-1">
          <img src={logoUrl} alt="Logo" className="h-9 w-auto" />
        </div>

        {done ? (
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: "var(--fg2)" }}
          >
            {t("registerSuccess")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <h1
              className="text-[15px] font-semibold text-center"
              style={{ color: "var(--fg1)" }}
            >
              {t("registerHeading")}
            </h1>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={fieldLabelStyle}
              >
                {t("email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                className="w-full rounded-[var(--radius)] px-3 py-2.5 text-[13px] outline-none border transition-colors"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--input)",
                  color: "var(--fg1)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--ring)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--input)";
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={fieldLabelStyle}
              >
                {t("registerPasswordLabel")}
              </label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={fieldLabelStyle}
              >
                {t("registerConfirmLabel")}
              </label>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              {password.length > 0 && confirm.length > 0 && (
                <div
                  className="flex items-center gap-1.5 text-[12px] pt-0.5"
                  style={{
                    color: matches ? "var(--success)" : "var(--destructive)",
                  }}
                >
                  {matches ? (
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  )}
                  <span>
                    {matches ? t("passwordsMatch") : t("resetPasswordMismatch")}
                  </span>
                </div>
              )}
            </div>

            {error && (
              <div
                className="text-[12.5px] text-center"
                style={{ color: "var(--destructive)" }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-2.5 rounded-[var(--radius)] text-[13px] font-medium disabled:opacity-60 transition-all active:scale-[0.98]"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow:
                  "0 0 20px color-mix(in oklch, var(--accent) 30%, transparent)",
              }}
            >
              {loading ? t("registerSubmitting") : t("registerSubmit")}
            </button>
          </form>
        )}

        <div className="text-center">
          <Link
            href="/login"
            className="text-[12.5px] transition-colors"
            style={{ color: "var(--fg2)" }}
          >
            {t("backToSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Login page — link, flag state, pending message**

In `src/app/login/page.tsx`:

3a. After the `emailConfigured` state declaration:

```ts
  const [emailConfigured, setEmailConfigured] = useState(
    () => getCachedConfig()?.emailConfigured ?? false
  );
```

add:

```ts
  const [registrationEnabled, setRegistrationEnabled] = useState(
    () => getCachedConfig()?.registrationEnabled ?? false
  );
```

3b. In the `getConfig().then((cfg) => { ... })` effect, after the line `setEmailConfigured(!!cfg.emailConfigured);` add:

```ts
        setRegistrationEnabled(!!cfg.registrationEnabled);
```

3c. In `onSubmit`, replace:

```ts
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("loginFailed"));
```

with:

```ts
        const data = await res.json().catch(() => ({}));
        setError(
          data.code === "pendingApproval"
            ? t("loginPendingApproval")
            : data.error || t("loginFailed")
        );
```

3d. Replace the forgot-password link block:

```tsx
        {emailConfigured && (
          <div className="text-center pt-1">
            <a
              href="/forgot-password"
              className="text-[12.5px] transition-colors"
              style={{ color: "var(--fg2)" }}
            >
              {t("forgotPassword")}
            </a>
          </div>
        )}
```

with:

```tsx
        {(emailConfigured || registrationEnabled) && (
          <div className="text-center pt-1 space-y-1.5">
            {emailConfigured && (
              <div>
                <a
                  href="/forgot-password"
                  className="text-[12.5px] transition-colors"
                  style={{ color: "var(--fg2)" }}
                >
                  {t("forgotPassword")}
                </a>
              </div>
            )}
            {registrationEnabled && (
              <div>
                <a
                  href="/register"
                  className="text-[12.5px] transition-colors"
                  style={{ color: "var(--fg2)" }}
                >
                  {t("createAccount")}
                </a>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Runtime verify (browser)**

1. `/login` shows "Create account"; clicking opens `/register`.
2. `/register`: type a password and a non-matching confirm → red X + "Passwords don't match." in `--destructive`; make them match → green check + "Passwords match" in `--success`; submit stays disabled until email + 8-char matching passwords.
3. Submit with a fresh email → success card text + back-to-sign-in link.
4. Submit again with the same email (new tab) → "This email is already registered."
5. Log in with those pending credentials → "Your account is awaiting approval by an administrator."
6. Restart dev with `ENABLE_REGISTRATION=false`: `/login` hides the link; opening `/register` directly redirects to `/login`. Restart normally afterwards.

- [ ] **Step 6: Commit**

```bash
git add src/app/register/ src/app/login/page.tsx
git commit -m "feat: /register page with live match indicator + login entry points

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Account-approved email template + shared sender

**Files:**
- Create: `src/lib/email/templates/types.ts`
- Create: `src/lib/email/templates/account-approved.ts`
- Modify: `src/lib/email/templates/password-reset.ts`
- Modify: `src/lib/email/send.ts` (rewrite — full file below)

**Interfaces:**
- Consumes: `renderEmailLayout`, `emailButton` (`src/lib/email/layout.ts`), `escapeHtml` (`src/lib/email/render.ts`), `sendMail` (`src/lib/email/transport.ts`), `cssColorToHex` (`src/lib/email/color.ts`), `getAppBaseUrl` (`src/lib/email/config.ts`), `getAppSettings` (`src/lib/settings.ts`), `readLogo` (`src/lib/branding.ts`).
- Produces: `sendAccountApprovedEmail(params: {to: string; userName: string}): Promise<void>` from `src/lib/email/send.ts` (throws when SMTP is unset or the send fails — caller decides how to handle). Task 9's approve route calls it. `composeAccountApproved(locale, vars)` and shared types `EmailLocale` / `ComposedEmail` now live in `templates/types.ts`.

- [ ] **Step 1: Extract the shared template types**

Create `src/lib/email/templates/types.ts`:

```ts
export type EmailLocale = "en" | "de";

export interface ComposedEmail {
  subject: string;
  previewText: string;
  bodyHtml: string;
  bodyText: string;
}
```

- [ ] **Step 2: Point password-reset at the shared types**

In `src/lib/email/templates/password-reset.ts`, replace:

```ts
import { emailButton } from "../layout";
import { escapeHtml } from "../render";

export type EmailLocale = "en" | "de";

export interface PasswordResetVars {
  userName: string;
  resetUrl: string;
  expiresMinutes: number;
  appTitle: string;
  accentHex: string;
}

export interface ComposedEmail {
  subject: string;
  previewText: string;
  bodyHtml: string;
  bodyText: string;
}
```

with:

```ts
import { emailButton } from "../layout";
import { escapeHtml } from "../render";
import type { ComposedEmail, EmailLocale } from "./types";

export interface PasswordResetVars {
  userName: string;
  resetUrl: string;
  expiresMinutes: number;
  appTitle: string;
  accentHex: string;
}
```

(The rest of the file — `BUILDERS` and `composePasswordReset` — is unchanged.)

- [ ] **Step 3: Create the account-approved template**

Create `src/lib/email/templates/account-approved.ts`:

```ts
import { emailButton } from "../layout";
import { escapeHtml } from "../render";
import type { ComposedEmail, EmailLocale } from "./types";

export interface AccountApprovedVars {
  userName: string;
  loginUrl: string;
  appTitle: string;
  accentHex: string;
}

const BUILDERS: Record<EmailLocale, (v: AccountApprovedVars) => ComposedEmail> =
  {
    en: (v) => {
      const name = escapeHtml(v.userName);
      const app = escapeHtml(v.appTitle);
      return {
        subject: `Your ${v.appTitle} account has been approved`,
        previewText: "Your account is ready — you can sign in now.",
        bodyHtml:
          `<p style="margin:0 0 12px;">Hi ${name},</p>` +
          `<p style="margin:0 0 12px;">Good news — an administrator has approved your ${app} account. You can now sign in with your email address and the password you chose at registration.</p>` +
          emailButton("Sign in", v.loginUrl, v.accentHex) +
          `<p style="margin:12px 0 0;color:#8a8a8a;font-size:12px;">If you didn't create this account, you can ignore this email.</p>`,
        bodyText:
          `Hi ${v.userName},\n\n` +
          `Good news — an administrator has approved your ${v.appTitle} account. ` +
          `You can now sign in with your email address and the password you chose at registration:\n\n${v.loginUrl}\n\n` +
          `If you didn't create this account, you can ignore this email.\n`,
      };
    },
    de: (v) => {
      const name = escapeHtml(v.userName);
      const app = escapeHtml(v.appTitle);
      return {
        subject: `Dein ${v.appTitle}-Konto wurde freigeschaltet`,
        previewText: "Dein Konto ist bereit — du kannst dich jetzt anmelden.",
        bodyHtml:
          `<p style="margin:0 0 12px;">Hallo ${name},</p>` +
          `<p style="margin:0 0 12px;">gute Nachrichten — ein Administrator hat dein ${app}-Konto freigeschaltet. Du kannst dich jetzt mit deiner E-Mail-Adresse und deinem bei der Registrierung gewählten Passwort anmelden.</p>` +
          emailButton("Jetzt anmelden", v.loginUrl, v.accentHex) +
          `<p style="margin:12px 0 0;color:#8a8a8a;font-size:12px;">Falls du dieses Konto nicht erstellt hast, kannst du diese E-Mail ignorieren.</p>`,
        bodyText:
          `Hallo ${v.userName},\n\n` +
          `gute Nachrichten — ein Administrator hat dein ${v.appTitle}-Konto freigeschaltet. ` +
          `Du kannst dich jetzt mit deiner E-Mail-Adresse und deinem bei der Registrierung gewählten Passwort anmelden:\n\n${v.loginUrl}\n\n` +
          `Falls du dieses Konto nicht erstellt hast, kannst du diese E-Mail ignorieren.\n`,
      };
    },
  };

export function composeAccountApproved(
  locale: EmailLocale,
  vars: AccountApprovedVars
): ComposedEmail {
  return (BUILDERS[locale] ?? BUILDERS.en)(vars);
}
```

- [ ] **Step 4: Rewrite send.ts with a shared delivery helper**

Replace the entire contents of `src/lib/email/send.ts` with:

```ts
import "server-only";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { readLogo } from "@/lib/branding";
import { getAppBaseUrl } from "./config";
import { sendMail, type OutgoingMail } from "./transport";
import { renderEmailLayout } from "./layout";
import { cssColorToHex } from "./color";
import type { ComposedEmail, EmailLocale } from "./templates/types";
import { composePasswordReset } from "./templates/password-reset";
import { composeAccountApproved } from "./templates/account-approved";

const LOGO_CID = "brandlogo";
const EXPIRES_MINUTES = 60;

interface Branding {
  settings: AppSettings;
  locale: EmailLocale;
  accentHex: string;
}

function getBranding(): Branding {
  const settings = getAppSettings();
  return {
    settings,
    locale: settings.locale === "de" ? "de" : "en",
    accentHex: cssColorToHex(settings.accentColor),
  };
}

// Shared delivery: branded layout + inline logo (CID) for PNG/JPEG only —
// SVG/WebP are unreliable across mail clients, so those fall back to a text
// wordmark in the layout.
async function deliverBrandedEmail(
  to: string,
  composed: ComposedEmail,
  branding: Branding
): Promise<void> {
  const attachments: NonNullable<OutgoingMail["attachments"]> = [];
  let logoCid: string | null = null;
  if (branding.settings.logoFile) {
    const logo = readLogo(branding.settings.logoFile);
    if (logo && (logo.mime === "image/png" || logo.mime === "image/jpeg")) {
      attachments.push({
        filename: branding.settings.logoFile,
        content: logo.buffer,
        cid: LOGO_CID,
        contentType: logo.mime,
      });
      logoCid = LOGO_CID;
    }
  }

  const html = renderEmailLayout({
    appTitle: branding.settings.appTitle,
    accentColor: branding.accentHex,
    logoCid,
    previewText: composed.previewText,
    bodyHtml: composed.bodyHtml,
  });

  await sendMail({
    to,
    subject: composed.subject,
    html,
    text: composed.bodyText,
    attachments: attachments.length ? attachments : undefined,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  userName: string;
  token: string;
}): Promise<void> {
  const branding = getBranding();
  const resetUrl = `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(
    params.token
  )}`;
  const composed = composePasswordReset(branding.locale, {
    userName: params.userName,
    resetUrl,
    expiresMinutes: EXPIRES_MINUTES,
    appTitle: branding.settings.appTitle,
    accentHex: branding.accentHex,
  });
  await deliverBrandedEmail(params.to, composed, branding);
}

export async function sendAccountApprovedEmail(params: {
  to: string;
  userName: string;
}): Promise<void> {
  const branding = getBranding();
  const composed = composeAccountApproved(branding.locale, {
    userName: params.userName,
    loginUrl: `${getAppBaseUrl()}/login`,
    appTitle: branding.settings.appTitle,
    accentHex: branding.accentHex,
  });
  await deliverBrandedEmail(params.to, composed, branding);
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. (This also proves the password-reset callers — forgot-password route and admin send-reset route — still compile against the refactor. Delivery itself is exercised end-to-end in Task 10's verification.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/email/templates/types.ts src/lib/email/templates/account-approved.ts src/lib/email/templates/password-reset.ts src/lib/email/send.ts
git commit -m "feat: account-approved email template; shared branded delivery helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Admin registrations API (list / approve / delete)

**Files:**
- Create: `src/app/api/admin/registrations/route.ts`
- Create: `src/app/api/admin/registrations/[id]/route.ts`
- Create: `src/app/api/admin/registrations/[id]/approve/route.ts`

**Interfaces:**
- Consumes: `registrations`, `users`, `groups` tables; `requireAdmin` (`src/lib/auth/session.ts`); `newId` (`src/lib/auth/crypto.ts`); `isEmailConfigured` (`src/lib/email/config.ts`); `sendAccountApprovedEmail` (Task 8).
- Produces (all `requireAdmin`-gated; Task 10's UI calls them):
  - `GET /api/admin/registrations` → `{registrations: {id: string; email: string; createdAt: number}[]}` (oldest first)
  - `POST /api/admin/registrations/[id]/approve` body `{groupId: string | null}` → 200 `{ok: true, emailSent: boolean}` · 400 unknown group / invalid payload · 404 · 409 email taken by an existing user
  - `DELETE /api/admin/registrations/[id]` → 200 `{ok: true}` · 404

- [ ] **Step 1: List route**

Create `src/app/api/admin/registrations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { registrations } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = db
    .select({
      id: registrations.id,
      email: registrations.email,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .orderBy(asc(registrations.createdAt))
    .all();

  return NextResponse.json({ registrations: rows });
}
```

- [ ] **Step 2: Delete route**

Create `src/app/api/admin/registrations/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { registrations } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_: Request, ctx: Ctx) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const row = db
    .select()
    .from(registrations)
    .where(eq(registrations.id, id))
    .get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.delete(registrations).where(eq(registrations.id, id)).run();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Approve route**

Create `src/app/api/admin/registrations/[id]/approve/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { groups, registrations, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { isEmailConfigured } from "@/lib/email/config";
import { sendAccountApprovedEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const Body = z.object({ groupId: z.string().nullable() });

export async function POST(request: Request, ctx: Ctx) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const reg = db
    .select()
    .from(registrations)
    .where(eq(registrations.id, id))
    .get();
  if (!reg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const groupId = parsed.data.groupId;
  if (groupId) {
    // FK enforcement is on (PRAGMA foreign_keys) — validate up front for a
    // friendly error instead of a raw constraint failure.
    const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
    if (!group) {
      return NextResponse.json({ error: "Unknown group." }, { status: 400 });
    }
  }

  // Atomic approval: the users insert and the registration delete commit
  // together. Re-check the email inside the transaction — an admin may have
  // created this user manually since the registration came in.
  const userId = newId();
  let emailTaken = false;
  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(users)
      .where(eq(users.email, reg.email))
      .get();
    if (existing) {
      emailTaken = true;
      return;
    }
    tx.insert(users)
      .values({
        id: userId,
        email: reg.email,
        passwordHash: reg.passwordHash,
        role: "user",
        groupId,
      })
      .run();
    tx.delete(registrations).where(eq(registrations.id, reg.id)).run();
  });
  if (emailTaken) {
    return NextResponse.json(
      {
        error:
          "A user with this email already exists. Delete the registration instead.",
      },
      { status: 409 }
    );
  }

  // Best-effort notification — the approval is already committed and a failed
  // send must never roll it back. emailSent tells the admin UI what happened.
  let emailSent = false;
  if (isEmailConfigured()) {
    try {
      await sendAccountApprovedEmail({ to: reg.email, userName: reg.email });
      emailSent = true;
    } catch (err) {
      Sentry.captureException(err);
    }
  }

  return NextResponse.json({ ok: true, emailSent });
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Runtime verify (curl with an admin session)**

With the dev server running (superadmin credentials from your `.env`):

```bash
curl -s -c /tmp/cortex-admin.cookies -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"<SUPERADMIN_EMAIL>","password":"<SUPERADMIN_PASSWORD>"}'
curl -s -b /tmp/cortex-admin.cookies http://localhost:3000/api/admin/registrations
```
Expected: `{"registrations":[{"id":"…","email":"pending@example.com","createdAt":…}]}` (the row from Task 5).

Approve it into no group (replace `<ID>` with the id from the list):

```bash
curl -s -b /tmp/cortex-admin.cookies -X POST http://localhost:3000/api/admin/registrations/<ID>/approve -H 'Content-Type: application/json' -d '{"groupId":null}'
```
Expected: `{"ok":true,"emailSent":true}` with Mailpit configured (check http://localhost:8025 — branded "account has been approved" mail), or `{"ok":true,"emailSent":false}` without SMTP.

```bash
sqlite3 ./data/cortex-chat.db "SELECT email, role FROM users WHERE email='pending@example.com'; SELECT count(*) FROM registrations;"
```
Expected: `pending@example.com|user` and `0`.

Login now works:

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"pending@example.com","password":"password123"}'
```
Expected: JSON with `"email":"pending@example.com"` and `"role":"user"`.

Unknown id check:

```bash
curl -s -b /tmp/cortex-admin.cookies -X DELETE http://localhost:3000/api/admin/registrations/nonexistent
```
Expected: `{"error":"Not found"}`

Clean up the test user afterwards (so Task 10's walkthrough can reuse the email):

```bash
sqlite3 ./data/cortex-chat.db "DELETE FROM users WHERE email='pending@example.com';"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/registrations/
git commit -m "feat: admin API to list, approve, and delete registrations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Admin UI — tabs, registrations table, approve dialog

**Files:**
- Modify: `src/components/admin/ui.tsx` (add shared `Tabs`)
- Modify: `src/app/admin/page.tsx` (use shared `Tabs`, delete local copy)
- Modify: `src/app/admin/users/page.tsx` (tabs + registrations tab + dialog)

**Interfaces:**
- Consumes: Task 9 endpoints, Task 3 i18n keys, existing `Modal`, `Table`/`Th`/`Td`, `Select`, `Button`, `ErrorBanner`, `getCachedConfig`.
- Produces: named export `Tabs<K extends string>({ active, onChange, tabs }: { active: K; onChange: (k: K) => void; tabs: { key: K; label: string }[] })` in `src/components/admin/ui.tsx`.

- [ ] **Step 1: Lift Tabs into the admin UI kit**

In `src/components/admin/ui.tsx`, append at the end of the file:

```tsx
// Underline tab bar (accent border marks the active tab). Lifted from the
// admin analytics page so users + analytics share one implementation.
export function Tabs<K extends string>({
  active,
  onChange,
  tabs,
}: {
  active: K;
  onChange: (k: K) => void;
  tabs: { key: K; label: string }[];
}) {
  return (
    <div
      className="flex gap-1 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="px-3 py-2 text-[13px] -mb-px border-b-2 transition-colors"
            style={{
              color: on ? "var(--fg1)" : "var(--fg2)",
              borderColor: on ? "var(--accent)" : "transparent",
              fontWeight: on ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Use the shared Tabs in the analytics page**

In `src/app/admin/page.tsx`:
1. Delete the entire local `function Tabs<K extends string>({ ... })` component (the block shown above — it is identical to what Step 1 added).
2. Add `Tabs` to the existing import from `@/components/admin/ui` (the file already imports `Table`, `Th`, `Td`, etc. from there — extend that import list with `Tabs`).

- [ ] **Step 3: Rework the users page**

In `src/app/admin/users/page.tsx`:

3a. Extend the admin-ui import (it already gained `PasswordInput` in Task 4) to also include `Tabs`:

```ts
import {
  Button,
  ErrorBanner,
  Input,
  PasswordInput,
  Select,
  Table,
  Tabs,
  Td,
  Th,
} from "@/components/admin/ui";
```

3b. After the `GroupRow` interface, add:

```ts
type TabKey = "users" | "registrations";

interface RegistrationRow {
  id: string;
  email: string;
  createdAt: number;
}
```

3c. Inside `AdminUsersPage`, after the `const [groups, setGroups] = ...` line, add:

```ts
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [tab, setTab] = useState<TabKey>("users");
  const [approving, setApproving] = useState<RegistrationRow | null>(null);
```

3d. Replace the `load` callback body so registrations load in the same parallel fetch:

```ts
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, g, r] = await Promise.all([
        fetch("/api/admin/users").then((res) => res.json()),
        fetch("/api/admin/groups").then((res) => res.json()),
        fetch("/api/admin/registrations").then((res) => res.json()),
      ]);
      if (u.error) throw new Error(u.error);
      setUsers(u.users ?? []);
      setViewerRole((u.viewerRole as ViewerRole) ?? "admin");
      setGroups(g.groups ?? []);
      setRegistrations(r.registrations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, []);
```

3e. After the `handleSendReset` function, add:

```ts
  async function handleDeleteRegistration(r: RegistrationRow) {
    if (!confirm(t("deleteRegistrationConfirm", { email: r.email }))) return;
    const res = await fetch(`/api/admin/registrations/${r.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || t("failedToDelete"));
      return;
    }
    await load();
  }
```

3f. In the returned JSX, make the New User button tab-scoped — replace:

```tsx
        <Button onClick={() => setEditing("new")}>{t("newUser")}</Button>
```

with:

```tsx
        {tab === "users" && (
          <Button onClick={() => setEditing("new")}>{t("newUser")}</Button>
        )}
```

3g. Directly after the closing `</div>` of the header row (the element wrapping the h1/description and the New User button), insert the tab bar:

```tsx
      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "users", label: t("usersTab") },
          {
            key: "registrations",
            label:
              registrations.length > 0
                ? `${t("registrationsTab")} (${registrations.length})`
                : t("registrationsTab"),
          },
        ]}
      />
```

3h. Scope the two tables to their tabs — replace:

```tsx
      {loading ? (
        <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
          {t("loading")}
        </div>
      ) : (
        <Table>
```

with:

```tsx
      {loading ? (
        <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
          {t("loading")}
        </div>
      ) : tab === "registrations" ? (
        <RegistrationsTable
          rows={registrations}
          onApprove={setApproving}
          onDelete={handleDeleteRegistration}
        />
      ) : (
        <Table>
```

(The existing users `<Table>…</Table>` block itself is unchanged.)

3i. After the `{editing && (<UserForm … />)}` block at the bottom of the component's JSX, add:

```tsx
      {approving && (
        <ApproveDialog
          registration={approving}
          groups={groups}
          emailConfigured={emailConfigured}
          onClose={() => setApproving(null)}
          onDone={async () => {
            setApproving(null);
            await load();
          }}
        />
      )}
```

(`emailConfigured` already exists in this component: `const emailConfigured = getCachedConfig()?.emailConfigured ?? false;`.)

3j. At the end of the file (after the `UserForm` component), append the two new components:

```tsx
function RegistrationsTable({
  rows,
  onApprove,
  onDelete,
}: {
  rows: RegistrationRow[];
  onApprove: (r: RegistrationRow) => void;
  onDelete: (r: RegistrationRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
        {t("registrationsEmpty")}
      </div>
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t("tableEmail")}</Th>
          <Th>{t("tableRegistered")}</Th>
          <Th>{t("actions")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{r.email}</Td>
            <Td>{new Date(r.createdAt).toLocaleString()}</Td>
            <Td>
              <div className="flex gap-2">
                <Button onClick={() => onApprove(r)}>
                  {t("confirmRegistration")}
                </Button>
                <Button variant="danger" onClick={() => onDelete(r)}>
                  {t("delete")}
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ApproveDialog({
  registration,
  groups,
  emailConfigured,
  onClose,
  onDone,
}: {
  registration: RegistrationRow;
  groups: GroupRow[];
  emailConfigured: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [groupId, setGroupId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/registrations/${registration.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: groupId || null }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("saveFailed"));
      alert(
        emailConfigured && !data.emailSent
          ? t("registrationApprovedNoEmail")
          : t("registrationApproved", { email: registration.email })
      );
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("confirmRegistrationTitle", { email: registration.email })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            {t("cancel")}
          </Button>
          <Button type="submit" form="approve-form" disabled={saving}>
            {saving ? t("confirmingRegistration") : t("confirmRegistration")}
          </Button>
        </>
      }
    >
      <form id="approve-form" onSubmit={handleSubmit} className="space-y-4">
        <Select
          label={t("tableGroup")}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          autoFocus
        >
          <option value="">{t("noGroupOption")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <p className="text-[11px]" style={{ color: "var(--fg2)" }}>
          {t("confirmRegistrationHint")}
        </p>
        <ErrorBanner message={error} />
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Runtime verify (browser, full loop)**

With the dev server + Mailpit running:

1. Register `walkthrough@example.com` on `/register`.
2. As superadmin, open `/admin/users`: two tabs, "Registrations (1)". Users tab unchanged (table, edit/delete/send-reset, New User button). Switching to Registrations hides the New User button.
3. Registrations tab: row shows email + registered timestamp, Confirm (accent) + Delete (danger).
4. Click Confirm → modal titled "Approve walkthrough@example.com" with group dropdown + hint. Pick a group, Confirm → alert "walkthrough@example.com has been approved.", tab count clears, user appears in the Users tab with the picked group.
5. Mailpit (http://localhost:8025) shows the branded approval mail; its "Sign in" button links to `http://localhost:3000/login`.
6. Log in as `walkthrough@example.com` in a private window → chat loads.
7. Register another email, then Delete it from the tab (confirm dialog) → row gone; that email can register again.
8. Admin analytics page (`/admin`) tabs still render and switch (shared Tabs regression check).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/ui.tsx src/app/admin/page.tsx src/app/admin/users/page.tsx
git commit -m "feat: registrations tab with approve dialog on /admin/users

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation + final verification sweep

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: project docs; the verified feature.

- [ ] **Step 1: Document the feature in CLAUDE.md**

In `CLAUDE.md`, insert a new section directly after the "## Password reset & email" section (before "## API Keys — How we talk to Cortex"):

```markdown
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
```

- [ ] **Step 2: Full manual checklist (spec §11)**

Run every item; all must pass:

1. Signup happy path → success card; row in Registrations tab with count badge.
2. Signup with a taken email (try both: an approved user's email and a pending one) → "This email is already registered."
3. Pending login with correct password → "awaiting approval" message; wrong password → generic error.
4. Confirm with a group → user in Users tab with that group; registration gone; approval email in Mailpit; login works. Switch app locale to DE in `/admin/settings`, approve another registration → German email; switch back.
5. Stop Mailpit, approve a registration → alert "Approved — but the confirmation email could not be sent."; user still created. Restart Mailpit.
6. Delete a registration → row gone; same email can register again.
7. `ENABLE_REGISTRATION=false npm run dev` → no login link, `/register` redirects, register API 404s, Registrations tab still lists/approves/deletes. Restart normally.
8. Eye toggle works on all 8 password fields (login 1, register 2, reset-password 2, profile 2, admin user form 1); aria-labels flip between the localized show/hide strings.
9. `npm run typecheck` → exits 0.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: self-registration section in CLAUDE.md

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
