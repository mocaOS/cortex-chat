# Password Reset & Email Sending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reset a forgotten password via a self-service email flow, and let admins trigger a reset email for any user, backed by the app's first SMTP email-sending capability.

**Architecture:** A server-only email module (`src/lib/email/`) sends branded HTML mail via `nodemailer`, configured entirely by env vars and feature-gated on `SMTP_HOST`. A new `password_reset_tokens` table stores single-use, hashed, time-limited tokens. Two public pages + two public API routes drive self-service; one admin route drives admin-triggered resets. Emails reuse the DB-backed branding (accent color, logo, title) from `app_settings`.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19 (client pages), TypeScript, Drizzle ORM + better-sqlite3, `nodemailer`, `zod`, existing `@node-rs/argon2` + `node:crypto`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Verification model (project decision — no test runner):** this repo has no test framework. Each task verifies with `npm run typecheck` (which is `tsc --noEmit`) and, where noted, a `npx tsx -e` smoke check on pure modules. The final task is a full manual Mailpit end-to-end. Do **not** add vitest/jest.
- **Feature gate:** all email behavior is off unless `SMTP_HOST` is set. The app must run exactly as today when it is unset.
- **Token rules:** 60-minute TTL; 60-second resend cooldown per user; token stored only as `sha256(token)` (hex); plaintext token appears **only** in the emailed link; single-use; creating a new token deletes the user's prior unused tokens.
- **On successful reset:** update `users.password_hash` **and** delete **all** of that user's `sessions` rows (atomic transaction). Minimum new-password length: **8**.
- **Enumeration-safe:** `POST /api/auth/forgot-password` always returns `200 { ok: true }` regardless of input validity or account existence, and never throws to the caller.
- **Superadmin excluded:** self-service issues no token for the superadmin (still 200); the admin route rejects a superadmin target with 400. Mirrors `src/app/api/admin/users/[id]/route.ts`.
- **Reset links** are built from `APP_BASE_URL` only — never the request `Host`/`X-Forwarded-Host` header.
- **Email copy is server-side only** — it must never be added to `src/lib/i18n.ts` (which ships to the client). Emails render in `getAppSettings().locale`.
- **Logo in email:** embed the configured logo as an inline CID attachment **only** when it is PNG or JPEG (`readLogo` mime check); otherwise render a text wordmark (SVG/WebP are unreliable in mail clients).
- **Styling:** client pages use MOCA tokens from `src/app/globals.css` only (`var(--bg)`, `var(--accent)`, `var(--fg1/2)`, `var(--border)`, `var(--input)`, `var(--ring)`, `var(--destructive)`, `var(--radius)`, `var(--radius-xl)`, `var(--accent-fg)`, `var(--shadow-xl)`). Dark-first. No new colors. Email HTML uses hardcoded inline styles (email clients can't use CSS vars) but pulls the accent color from settings converted to hex.
- **i18n:** German uses du-form; keep product terms (Deep Research, etc.) in English.
- **Commit after each task** using the exact message shown.
- **Server modules** that touch env/db/nodemailer start with `import "server-only";`. Pure string/math helpers (`render.ts`, `color.ts`, `layout.ts`, `templates/*`) do **not** import `server-only` (so they stay smoke-testable via `tsx`) and use **relative** intra-module imports.

**Deviation from spec (flagged):** the spec's `render.ts` described a `${var}` substitution renderer. This plan uses type-safe TypeScript compose functions instead (no missing-variable risk) and keeps `render.ts` only for `escapeHtml`. Output and design intent are unchanged. It also adds `src/lib/email/color.ts` (not in the spec) to convert the DB accent color — `oklch(...)` by default — to a hex the CTA button renders correctly in mail clients.

---

### Task 1: Dependencies, email env config, boot validation, env docs

**Files:**
- Modify: `package.json` (add `nodemailer`, `@types/nodemailer`)
- Create: `src/lib/email/config.ts`
- Modify: `src/instrumentation.ts:82-118` (`validateRequiredEnv`)
- Modify: `.env.example` (append SMTP section)
- Modify: `docker-compose.yml` (env passthrough)

**Interfaces:**
- Produces: `isEmailConfigured(): boolean`, `getSmtpConfig(): SmtpConfig | null`, `getAppBaseUrl(): string` from `@/lib/email/config`.

- [ ] **Step 1: Install nodemailer**

Run: `npm install nodemailer && npm install -D @types/nodemailer`
Expected: both added to `package.json`, no install errors.

- [ ] **Step 2: Create the email config module**

Create `src/lib/email/config.ts`:

```ts
import "server-only";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
}

// Feature switch: email is entirely off unless an SMTP host is configured.
export function isEmailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const parsedPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return {
    host,
    port: Number.isFinite(parsedPort) ? parsedPort : 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: user && pass ? { user, pass } : undefined,
    from: process.env.SMTP_FROM || "",
  };
}

// Absolute base URL for links in emails (no trailing slash). Never derived from
// the request Host header — that would enable password-reset link poisoning.
export function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
}
```

- [ ] **Step 3: Add conditional boot validation**

In `src/instrumentation.ts`, inside `validateRequiredEnv()`, immediately before the final `if (errors.length > 0) {` block, insert:

```ts
  // Email is optional (feature-gated on SMTP_HOST). But if SMTP is configured,
  // the pieces required to send a usable reset email must all be present.
  if (process.env.SMTP_HOST) {
    if (!process.env.SMTP_FROM) {
      errors.push(
        'SMTP_FROM is required when SMTP_HOST is set (e.g. "Cortex Chat <no-reply@example.com>").'
      );
    }
    if (!process.env.APP_BASE_URL) {
      errors.push(
        "APP_BASE_URL is required when SMTP_HOST is set (absolute base URL for reset links, e.g. https://chat.example.com)."
      );
    } else if (!/^https?:\/\//.test(process.env.APP_BASE_URL)) {
      errors.push("APP_BASE_URL must start with http:// or https://.");
    }
  }
```

- [ ] **Step 4: Document env vars in `.env.example`**

Append to `.env.example`:

```
# --- Email / SMTP (optional) -------------------------------------------------
# Enables the password-reset flow. Leave SMTP_HOST unset to keep email off
# entirely (the "Forgot password?" link and admin "Send reset email" button
# are hidden). When SMTP_HOST is set, SMTP_FROM and APP_BASE_URL are required.
#
# Local testing with Mailpit: SMTP is on port 1025 (NOT 8025 — that's Mailpit's
# web UI where you read the delivered mail).
#   SMTP_HOST=localhost
#   SMTP_PORT=1025
#   SMTP_FROM="Cortex Chat <no-reply@example.com>"
#   APP_BASE_URL=http://localhost:3000

# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=            # optional (omit for Mailpit — no auth)
# SMTP_PASS=            # optional (omit for Mailpit)
# SMTP_SECURE=false     # true ⇒ implicit TLS (port 465); false ⇒ STARTTLS (587)
# SMTP_FROM=
# APP_BASE_URL=
```

- [ ] **Step 5: Pass env through in `docker-compose.yml`**

In `docker-compose.yml`, under `services.cortex-chat.environment`, add after `SENTRY_ENVIRONMENT`:

```yaml
      # Email / SMTP (optional — password reset is off unless SMTP_HOST is set).
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      SMTP_SECURE: ${SMTP_SECURE:-false}
      SMTP_FROM: ${SMTP_FROM:-}
      APP_BASE_URL: ${APP_BASE_URL:-}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/email/config.ts src/instrumentation.ts .env.example docker-compose.yml
git commit -m "feat(email): add nodemailer, SMTP env config, and boot validation"
```

---

### Task 2: `password_reset_tokens` table + migration

**Files:**
- Modify: `src/lib/db/schema.ts` (add table + type)
- Create: `src/lib/db/migrations/0003_*.sql` (generated)

**Interfaces:**
- Produces: `passwordResetTokens` Drizzle table and `PasswordResetToken` type from `@/lib/db/schema`.

- [ ] **Step 1: Add the table to the schema**

In `src/lib/db/schema.ts`, change the top import line:

```ts
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
```

Then add, after the `sessions` table definition (before `loginEvents`):

```ts
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // sha256(token) hex. The plaintext token lives ONLY in the emailed link.
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"), // null until consumed (single-use)
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    tokenHashIdx: index("idx_prt_token_hash").on(t.tokenHash),
    userIdIdx: index("idx_prt_user_id").on(t.userId),
  })
);
```

And add near the other type exports at the bottom:

```ts
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `src/lib/db/migrations/0003_*.sql` is created containing `CREATE TABLE password_reset_tokens` plus two `CREATE INDEX` statements. Open it and confirm those statements are present.

- [ ] **Step 3: Apply the migration locally**

Run: `npm run db:migrate`
Expected: applies cleanly with no error (creates the table in `./data/cortex-chat.db`).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/
git commit -m "feat(db): add password_reset_tokens table (migration 0003)"
```

---

### Task 3: Reset-token service

**Files:**
- Create: `src/lib/auth/reset-token.ts`

**Interfaces:**
- Consumes: `passwordResetTokens` from `@/lib/db/schema`; `newId` from `@/lib/auth/crypto`.
- Produces:
  - `hashResetToken(token: string): string`
  - `createResetToken(userId: string): { token: string; expiresAt: number }`
  - `hasRecentResetToken(userId: string): boolean`
  - `findResetTokenUser(token: string): { id: string; userId: string } | null`

- [ ] **Step 1: Create the service module**

Create `src/lib/auth/reset-token.ts`:

```ts
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { passwordResetTokens } from "@/lib/db/schema";
import { newId } from "./crypto";

const TTL_MS = 60 * 60 * 1000; // 60 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Mints a fresh single-use token for the user, invalidating any prior unused
// ones. Returns the PLAINTEXT token — exposed only via the emailed link.
export function createResetToken(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  db.transaction((tx) => {
    tx.delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt)
        )
      )
      .run();
    tx.insert(passwordResetTokens)
      .values({ id: newId(), userId, tokenHash, expiresAt, createdAt: now })
      .run();
  });
  return { token, expiresAt };
}

// True if an unused, unexpired token was minted for this user within the resend
// cooldown — used to throttle repeated "forgot password" submissions.
export function hasRecentResetToken(userId: string): boolean {
  const now = Date.now();
  const row = db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.createdAt, now - RESEND_COOLDOWN_MS),
        gt(passwordResetTokens.expiresAt, now)
      )
    )
    .get();
  return !!row;
}

// Returns the token row id + userId for a valid (exists, unused, unexpired)
// token, else null. Does not mutate — the caller consumes it atomically.
export function findResetTokenUser(
  token: string
): { id: string; userId: string } | null {
  const tokenHash = hashResetToken(token);
  const row = db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      usedAt: passwordResetTokens.usedAt,
      expiresAt: passwordResetTokens.expiresAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .get();
  if (!row) return null;
  if (row.usedAt !== null) return null;
  if (row.expiresAt < Date.now()) return null;
  return { id: row.id, userId: row.userId };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/reset-token.ts
git commit -m "feat(auth): add hashed single-use password-reset token service"
```

---

### Task 4: Email HTML helpers — `render.ts`, `color.ts`, `layout.ts`

**Files:**
- Create: `src/lib/email/render.ts`
- Create: `src/lib/email/color.ts`
- Create: `src/lib/email/layout.ts`

**Interfaces:**
- Produces:
  - `escapeHtml(s: string): string` from `./render`
  - `cssColorToHex(input: string): string` from `./color`
  - `renderEmailLayout(input: EmailLayoutInput): string` and `emailButton(label, href, accentHex): string` from `./layout`
  - `EmailLayoutInput = { appTitle: string; accentColor: string; logoCid: string | null; previewText: string; bodyHtml: string }`

- [ ] **Step 1: Create the HTML-escape helper**

Create `src/lib/email/render.ts`:

```ts
// Pure (no server-only) so it stays smoke-testable. Escapes user-controlled
// text before it goes into email HTML.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Create the color converter**

Create `src/lib/email/color.ts`:

```ts
// Converts a CSS color (hex, rgb(), or oklch()) to a #rrggbb hex string that
// mail clients render reliably. The DB accent default is oklch(...), which most
// email clients do NOT support — so we convert it here. Falls back to a safe
// neutral accent for anything unparseable.
const FALLBACK = "#c9a227";

export function cssColorToHex(input: string): string {
  const s = (input || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  const rgb = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) {
    return toHex(Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255);
  }
  const oklch = s.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/
  );
  if (oklch) {
    let L = parseFloat(oklch[1]);
    if (oklch[1].endsWith("%")) L = L / 100;
    const C = parseFloat(oklch[2]);
    const H = parseFloat(oklch[3]);
    const [r, g, b] = oklchToLinearSrgb(L, C, H);
    return toHex(gammaEncode(r), gammaEncode(g), gammaEncode(b));
  }
  return FALLBACK;
}

function oklchToLinearSrgb(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function gammaEncode(x: number): number {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, c));
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}
```

- [ ] **Step 3: Smoke-check the color converter**

Run:
```bash
npx tsx -e "import('./src/lib/email/color.ts').then(m=>{const a=m.cssColorToHex('oklch(0.79 0.18 70.67)');const b=m.cssColorToHex('#ff9500');const c=m.cssColorToHex('rgb(200,100,50)');const d=m.cssColorToHex('var(--nope)');console.log(a,b,c,d);if(!/^#[0-9a-f]{6}$/.test(a))throw new Error('oklch not hex');if(b!=='#ff9500')throw new Error('hex passthrough');console.log('OK')})"
```
Expected: four `#rrggbb` values printed, the first (from the default oklch accent) a warm yellow-green, and `OK` at the end. Fails loudly if the oklch output isn't a hex string.

- [ ] **Step 4: Create the layout**

Create `src/lib/email/layout.ts`:

```ts
import { escapeHtml } from "./render";

export interface EmailLayoutInput {
  appTitle: string; // raw text; escaped internally
  accentColor: string; // #rrggbb
  logoCid: string | null; // inline-attachment content-id, or null for wordmark
  previewText: string; // raw text; escaped internally
  bodyHtml: string; // trusted composed HTML
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderEmailLayout(input: EmailLayoutInput): string {
  const title = escapeHtml(input.appTitle);
  const preview = escapeHtml(input.previewText);
  const header = input.logoCid
    ? `<img src="cid:${input.logoCid}" alt="${title}" height="32" style="height:32px;width:auto;display:block;margin:0 auto;" />`
    : `<div style="font:600 18px ${FONT};color:#e7e7e7;text-align:center;">${title}</div>`;
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0e0e0e;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0e;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">${header}</td></tr>
        <tr><td style="padding:8px 32px 32px;font:400 14px/1.6 ${FONT};color:#c9c9c9;">${input.bodyHtml}</td></tr>
      </table>
      <div style="max-width:480px;margin:16px auto 0;font:400 11px ${FONT};color:#6b6b6b;text-align:center;">${title}</div>
    </td></tr>
  </table>
</body>
</html>`;
}

// Accent CTA button. `accentHex` must be #rrggbb (email clients can't do oklch).
export function emailButton(label: string, href: string, accentHex: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-radius:8px;background:${accentHex};">
    <a href="${href}" style="display:inline-block;padding:11px 22px;font:600 14px ${FONT};color:#111111;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}
```

- [ ] **Step 5: Smoke-check the layout**

Run:
```bash
npx tsx -e "import('./src/lib/email/layout.ts').then(m=>{const h=m.renderEmailLayout({appTitle:'Ask <b>Cortex</b>',accentColor:'#c9a227',logoCid:null,previewText:'hi',bodyHtml:m.emailButton('Reset','https://x/y?token=a&b','#c9a227')});if(h.includes('<b>Cortex'))throw new Error('title not escaped');if(!h.includes('cid:')&&!h.includes('Ask &lt;b&gt;'))throw new Error('wordmark missing');console.log('OK len',h.length)})"
```
Expected: prints `OK len <number>`; throws if the title wasn't HTML-escaped.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email/render.ts src/lib/email/color.ts src/lib/email/layout.ts
git commit -m "feat(email): add HTML escape, oklch→hex color, and branded layout"
```

---

### Task 5: Password-reset template, transport, and send

**Files:**
- Create: `src/lib/email/templates/password-reset.ts`
- Create: `src/lib/email/transport.ts`
- Create: `src/lib/email/send.ts`

**Interfaces:**
- Consumes: `renderEmailLayout`, `emailButton` (`./layout`); `escapeHtml` (`./render`); `cssColorToHex` (`./color`); `getSmtpConfig`, `getAppBaseUrl` (`./config`); `getAppSettings` (`@/lib/settings`); `readLogo` (`@/lib/branding`).
- Produces:
  - `composePasswordReset(locale, vars): { subject; bodyHtml; bodyText; previewText }` from `./templates/password-reset`
  - `sendMail(mail: OutgoingMail): Promise<void>` from `./transport`
  - `sendPasswordResetEmail(params: { to; userName; token }): Promise<void>` from `./send`

- [ ] **Step 1: Create the password-reset template**

Create `src/lib/email/templates/password-reset.ts`:

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

const BUILDERS: Record<EmailLocale, (v: PasswordResetVars) => ComposedEmail> = {
  en: (v) => {
    const name = escapeHtml(v.userName);
    const app = escapeHtml(v.appTitle);
    return {
      subject: `Reset your ${v.appTitle} password`,
      previewText: `Reset your password — link expires in ${v.expiresMinutes} minutes.`,
      bodyHtml:
        `<p style="margin:0 0 12px;">Hi ${name},</p>` +
        `<p style="margin:0 0 12px;">We received a request to reset the password for your ${app} account. Choose a new password with the button below.</p>` +
        emailButton("Reset password", v.resetUrl, v.accentHex) +
        `<p style="margin:12px 0 0;color:#8a8a8a;font-size:12px;">This link expires in ${v.expiresMinutes} minutes and can be used once. If you didn't request this, you can ignore this email — your password won't change.</p>`,
      bodyText:
        `Hi ${v.userName},\n\n` +
        `We received a request to reset the password for your ${v.appTitle} account. ` +
        `Open this link to choose a new password:\n\n${v.resetUrl}\n\n` +
        `This link expires in ${v.expiresMinutes} minutes and can be used once. ` +
        `If you didn't request this, you can ignore this email — your password won't change.\n`,
    };
  },
  de: (v) => {
    const name = escapeHtml(v.userName);
    const app = escapeHtml(v.appTitle);
    return {
      subject: `Setze dein ${v.appTitle}-Passwort zurück`,
      previewText: `Passwort zurücksetzen — der Link läuft in ${v.expiresMinutes} Minuten ab.`,
      bodyHtml:
        `<p style="margin:0 0 12px;">Hallo ${name},</p>` +
        `<p style="margin:0 0 12px;">wir haben eine Anfrage erhalten, das Passwort für dein ${app}-Konto zurückzusetzen. Wähle mit dem Button unten ein neues Passwort.</p>` +
        emailButton("Passwort zurücksetzen", v.resetUrl, v.accentHex) +
        `<p style="margin:12px 0 0;color:#8a8a8a;font-size:12px;">Dieser Link läuft in ${v.expiresMinutes} Minuten ab und kann einmal verwendet werden. Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren — dein Passwort bleibt unverändert.</p>`,
      bodyText:
        `Hallo ${v.userName},\n\n` +
        `wir haben eine Anfrage erhalten, das Passwort für dein ${v.appTitle}-Konto zurückzusetzen. ` +
        `Öffne diesen Link, um ein neues Passwort zu wählen:\n\n${v.resetUrl}\n\n` +
        `Dieser Link läuft in ${v.expiresMinutes} Minuten ab und kann einmal verwendet werden. ` +
        `Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren — dein Passwort bleibt unverändert.\n`,
    };
  },
};

export function composePasswordReset(
  locale: EmailLocale,
  vars: PasswordResetVars
): ComposedEmail {
  return (BUILDERS[locale] ?? BUILDERS.en)(vars);
}
```

- [ ] **Step 2: Smoke-check the template**

Run:
```bash
npx tsx -e "import('./src/lib/email/templates/password-reset.ts').then(m=>{for(const loc of ['en','de']){const c=m.composePasswordReset(loc,{userName:'Ada',resetUrl:'https://x/reset-password?token=abc',expiresMinutes:60,appTitle:'Ask Cortex',accentHex:'#c9a227'});if(!c.subject||!c.bodyHtml.includes('https://x/reset-password')||!c.bodyText.includes('https://x/reset-password'))throw new Error('missing '+loc);}console.log('OK')})"
```
Expected: prints `OK`.

- [ ] **Step 3: Create the transport**

Create `src/lib/email/transport.ts`:

```ts
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getSmtpConfig } from "./config";

let cached: Transporter | null = null;

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: {
    filename: string;
    content: Buffer;
    cid: string;
    contentType?: string;
  }[];
}

function getTransport(): Transporter | null {
  const cfg = getSmtpConfig();
  if (!cfg) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
    });
  }
  return cached;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const cfg = getSmtpConfig();
  const transport = getTransport();
  if (!cfg || !transport) {
    throw new Error("Email is not configured (SMTP_HOST unset).");
  }
  await transport.sendMail({
    from: cfg.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  });
}
```

- [ ] **Step 4: Create the send function**

Create `src/lib/email/send.ts`:

```ts
import "server-only";
import { getAppSettings } from "@/lib/settings";
import { readLogo } from "@/lib/branding";
import { getAppBaseUrl } from "./config";
import { sendMail, type OutgoingMail } from "./transport";
import { renderEmailLayout } from "./layout";
import { cssColorToHex } from "./color";
import {
  composePasswordReset,
  type EmailLocale,
} from "./templates/password-reset";

const LOGO_CID = "brandlogo";
const EXPIRES_MINUTES = 60;

export async function sendPasswordResetEmail(params: {
  to: string;
  userName: string;
  token: string;
}): Promise<void> {
  const settings = getAppSettings();
  const locale: EmailLocale = settings.locale === "de" ? "de" : "en";
  const accentHex = cssColorToHex(settings.accentColor);
  const resetUrl = `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(
    params.token
  )}`;

  const composed = composePasswordReset(locale, {
    userName: params.userName,
    resetUrl,
    expiresMinutes: EXPIRES_MINUTES,
    appTitle: settings.appTitle,
    accentHex,
  });

  // Embed the configured logo inline (CID) only for PNG/JPEG — SVG/WebP are
  // unreliable across mail clients, so we fall back to a text wordmark.
  const attachments: NonNullable<OutgoingMail["attachments"]> = [];
  let logoCid: string | null = null;
  if (settings.logoFile) {
    const logo = readLogo(settings.logoFile);
    if (logo && (logo.mime === "image/png" || logo.mime === "image/jpeg")) {
      attachments.push({
        filename: settings.logoFile,
        content: logo.buffer,
        cid: LOGO_CID,
        contentType: logo.mime,
      });
      logoCid = LOGO_CID;
    }
  }

  const html = renderEmailLayout({
    appTitle: settings.appTitle,
    accentColor: accentHex,
    logoCid,
    previewText: composed.previewText,
    bodyHtml: composed.bodyHtml,
  });

  await sendMail({
    to: params.to,
    subject: composed.subject,
    html,
    text: composed.bodyText,
    attachments: attachments.length ? attachments : undefined,
  });
}
```

Note: `escapeHtml` is imported because `renderEmailLayout` escapes internally — but keep the import only if used. It is **not** used directly here, so remove the `escapeHtml` import line before typechecking (the layout handles escaping).

- [ ] **Step 5: Remove the unused import**

In `src/lib/email/send.ts`, delete the line `import { escapeHtml } from "./render";` (the layout escapes internally; a stray import will fail `tsc` under the project's settings).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email/templates/password-reset.ts src/lib/email/transport.ts src/lib/email/send.ts
git commit -m "feat(email): add password-reset template, SMTP transport, and send()"
```

---

### Task 6: Expose `emailConfigured` through ClientConfig

**Files:**
- Modify: `src/lib/config.ts` (interface + fallback)
- Modify: `src/app/api/config/route.ts`
- Modify: `src/app/layout.tsx:53-63`

**Interfaces:**
- Produces: `ClientConfig.emailConfigured: boolean`, populated from `isEmailConfigured()`.

- [ ] **Step 1: Add the field to the client config type + fallback**

In `src/lib/config.ts`, add to the `ClientConfig` interface after `defaultChatMode`:

```ts
  emailConfigured: boolean;
```

And in the `catch` fallback object inside `getConfig()`, add after `defaultChatMode: "chat",`:

```ts
      emailConfigured: false,
```

- [ ] **Step 2: Return it from `/api/config`**

In `src/app/api/config/route.ts`, add the import:

```ts
import { isEmailConfigured } from "@/lib/email/config";
```

And add to the returned JSON object after `defaultChatMode: settings.defaultChatMode,`:

```ts
    emailConfigured: isEmailConfigured(),
```

- [ ] **Step 3: Seed it from the server layout**

In `src/app/layout.tsx`, add the import near the other `@/lib` imports:

```ts
import { isEmailConfigured } from "@/lib/email/config";
```

And add to the `initialConfig` object after `defaultChatMode: settings.defaultChatMode,`:

```ts
    emailConfigured: isEmailConfigured(),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms every `ClientConfig` literal now includes `emailConfigured`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts src/app/api/config/route.ts src/app/layout.tsx
git commit -m "feat(config): expose emailConfigured flag to the client"
```

---

### Task 7: Forgot-password API route + public paths

**Files:**
- Create: `src/app/api/auth/forgot-password/route.ts`
- Modify: `src/middleware.ts:6-11` (`PUBLIC_PATHS`)

**Interfaces:**
- Consumes: `isEmailConfigured` (`@/lib/email/config`); `createResetToken`, `hasRecentResetToken` (`@/lib/auth/reset-token`); `sendPasswordResetEmail` (`@/lib/email/send`).

- [ ] **Step 1: Add all four public paths to middleware**

In `src/middleware.ts`, replace the `PUBLIC_PATHS` set with:

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

- [ ] **Step 2: Create the forgot-password route**

Create `src/app/api/auth/forgot-password/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isEmailConfigured } from "@/lib/email/config";
import { createResetToken, hasRecentResetToken } from "@/lib/auth/reset-token";
import { sendPasswordResetEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  // Enumeration-safe: always return 200, regardless of input or existence.
  if (parsed.success) {
    const email = parsed.data.email.trim().toLowerCase();
    try {
      if (isEmailConfigured()) {
        const user = db.select().from(users).where(eq(users.email, email)).get();
        // Skip the superadmin (env-managed password) and throttle resends.
        if (user && user.role !== "superadmin" && !hasRecentResetToken(user.id)) {
          const { token } = createResetToken(user.id);
          await sendPasswordResetEmail({
            to: user.email,
            userName: user.username || user.email,
            token,
          });
        }
      }
    } catch (err) {
      // Never surface failures to the caller (would break enumeration-safety
      // and leak SMTP issues). Report server-side for the operator.
      Sentry.captureException(err);
    }
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/forgot-password/route.ts src/middleware.ts
git commit -m "feat(auth): add enumeration-safe forgot-password route"
```

---

### Task 8: Reset-password API route (GET validate + POST reset)

**Files:**
- Create: `src/app/api/auth/reset-password/route.ts`

**Interfaces:**
- Consumes: `findResetTokenUser` (`@/lib/auth/reset-token`); `hashPassword` (`@/lib/auth/password`); `users`, `sessions`, `passwordResetTokens` (`@/lib/db/schema`).

- [ ] **Step 1: Create the reset-password route**

Create `src/app/api/auth/reset-password/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { passwordResetTokens, sessions, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { findResetTokenUser } from "@/lib/auth/reset-token";

export const dynamic = "force-dynamic";

// Lightweight validity probe so the page can show "expired" state on load.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  return NextResponse.json({ valid: !!token && !!findResetTokenUser(token) });
}

const Body = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
  const match = findResetTokenUser(parsed.data.token);
  if (!match) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 }
    );
  }
  const newHash = await hashPassword(parsed.data.newPassword);
  // Atomic: set the new password, mark the token used, kill all sessions.
  db.transaction((tx) => {
    tx.update(users)
      .set({ passwordHash: newHash, updatedAt: Date.now() })
      .where(eq(users.id, match.userId))
      .run();
    tx.update(passwordResetTokens)
      .set({ usedAt: Date.now() })
      .where(eq(passwordResetTokens.id, match.id))
      .run();
    tx.delete(sessions).where(eq(sessions.userId, match.userId)).run();
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/reset-password/route.ts
git commit -m "feat(auth): add reset-password validate + consume route"
```

---

### Task 9: Admin send-reset API route

**Files:**
- Create: `src/app/api/admin/users/[id]/send-reset/route.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`@/lib/auth/session`); `isEmailConfigured` (`@/lib/email/config`); `createResetToken` (`@/lib/auth/reset-token`); `sendPasswordResetEmail` (`@/lib/email/send`); `users` (`@/lib/db/schema`).

- [ ] **Step 1: Create the admin send-reset route**

Create `src/app/api/admin/users/[id]/send-reset/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { isEmailConfigured } from "@/lib/email/config";
import { createResetToken } from "@/lib/auth/reset-token";
import { sendPasswordResetEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_: Request, ctx: Ctx) {
  let callerRole: "admin" | "superadmin";
  try {
    const { user } = await requireAdmin();
    callerRole = user.role as "admin" | "superadmin";
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email is not configured on this server." },
      { status: 400 }
    );
  }

  const { id } = await ctx.params;
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Superadmin password is env-managed — mirror the user-edit route's refusal.
  if (target.role === "superadmin") {
    return NextResponse.json(
      { error: "The superadmin password is managed via env (SUPERADMIN_PASSWORD)." },
      { status: 400 }
    );
  }
  // Admin callers may only reset regular users.
  if (callerRole === "admin" && target.role === "admin") {
    return NextResponse.json(
      { error: "Only the superadmin can reset admin accounts." },
      { status: 403 }
    );
  }

  const { token } = createResetToken(target.id);
  await sendPasswordResetEmail({
    to: target.email,
    userName: target.username || target.email,
    token,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/users/
git commit -m "feat(admin): add send password-reset email route"
```

---

### Task 10: i18n keys for reset UI

**Files:**
- Modify: `src/lib/i18n.ts` (add keys to both `en` and `de`, in the "Auth / login" section)

**Interfaces:**
- Produces: the translation keys consumed by Tasks 11–13.

- [ ] **Step 1: Add English keys**

In `src/lib/i18n.ts`, inside the `en:` object, after `loginFailed: "Sign in failed",`, add:

```ts
    forgotPassword: "Forgot password?",
    forgotPasswordHeading: "Reset your password",
    forgotPasswordDescription:
      "Enter your email and we'll send you a link to reset your password.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent:
      "If that email is registered, we've sent a reset link. Check your inbox.",
    backToSignIn: "Back to sign in",
    resetPasswordHeading: "Choose a new password",
    resetPasswordNew: "New password (min. 8 characters)",
    resetPasswordConfirm: "Confirm new password",
    resetPasswordSubmit: "Set new password",
    resetPasswordSaving: "Saving…",
    resetPasswordSuccess: "Password updated. You can now sign in.",
    resetPasswordMismatch: "Passwords don't match.",
    resetPasswordInvalid:
      "This reset link is invalid or has expired. Request a new one.",
    resetPasswordCheckingLink: "Checking link…",
    sendResetEmail: "Send reset email",
    sendResetEmailConfirm: "Send a password reset email to {email}?",
    sendResetEmailSent: "Reset email sent to {email}.",
    sendResetEmailFailed: "Could not send reset email.",
```

- [ ] **Step 2: Add German keys (du-form)**

In the `de:` object, after `loginFailed: "Anmeldung fehlgeschlagen",`, add:

```ts
    forgotPassword: "Passwort vergessen?",
    forgotPasswordHeading: "Passwort zurücksetzen",
    forgotPasswordDescription:
      "Gib deine E-Mail ein und wir senden dir einen Link zum Zurücksetzen deines Passworts.",
    forgotPasswordSubmit: "Link senden",
    forgotPasswordSending: "Sende…",
    forgotPasswordSent:
      "Falls diese E-Mail registriert ist, haben wir einen Link zum Zurücksetzen gesendet. Sieh in deinem Postfach nach.",
    backToSignIn: "Zurück zur Anmeldung",
    resetPasswordHeading: "Neues Passwort wählen",
    resetPasswordNew: "Neues Passwort (mind. 8 Zeichen)",
    resetPasswordConfirm: "Neues Passwort bestätigen",
    resetPasswordSubmit: "Neues Passwort setzen",
    resetPasswordSaving: "Speichert…",
    resetPasswordSuccess: "Passwort aktualisiert. Du kannst dich jetzt anmelden.",
    resetPasswordMismatch: "Die Passwörter stimmen nicht überein.",
    resetPasswordInvalid:
      "Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen an.",
    resetPasswordCheckingLink: "Prüfe Link…",
    sendResetEmail: "Reset-E-Mail senden",
    sendResetEmailConfirm:
      "Eine E-Mail zum Zurücksetzen des Passworts an {email} senden?",
    sendResetEmailSent: "Reset-E-Mail an {email} gesendet.",
    sendResetEmailFailed: "Reset-E-Mail konnte nicht gesendet werden.",
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the `TranslationKey` union now includes the new keys; `en` and `de` must stay in sync or `tsc` flags the `as const` mismatch).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(i18n): add password-reset UI strings (EN/DE)"
```

---

### Task 11: `/forgot-password` page

**Files:**
- Create: `src/app/forgot-password/page.tsx`

**Interfaces:**
- Consumes: `getConfig`, `getCachedConfig` (`@/lib/config`); `t` (`@/lib/i18n`); `useLocale` (`@/lib/i18n-client`).

- [ ] **Step 1: Create the page**

Create `src/app/forgot-password/page.tsx` (MOCA glass card, mirrors the login page):

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

export default function ForgotPasswordPage() {
  useLocale();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* Always show the same confirmation regardless of outcome. */
    }
    setSent(true);
    setLoading(false);
  }

  if (!ready) return <div className="h-dvh" style={{ background: "var(--bg)" }} />;

  return (
    <div
      className="h-dvh flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
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

        {sent ? (
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: "var(--fg2)" }}
          >
            {t("forgotPasswordSent")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <h1
                className="text-[15px] font-semibold text-center"
                style={{ color: "var(--fg1)" }}
              >
                {t("forgotPasswordHeading")}
              </h1>
              <p
                className="text-[12.5px] text-center leading-relaxed"
                style={{ color: "var(--fg2)" }}
              >
                {t("forgotPasswordDescription")}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--fg2)" }}
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-[var(--radius)] text-[13px] font-medium disabled:opacity-60 transition-all active:scale-[0.98]"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow:
                  "0 0 20px color-mix(in oklch, var(--accent) 30%, transparent)",
              }}
            >
              {loading ? t("forgotPasswordSending") : t("forgotPasswordSubmit")}
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

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/forgot-password/page.tsx
git commit -m "feat(ui): add /forgot-password page"
```

---

### Task 12: `/reset-password` page

**Files:**
- Create: `src/app/reset-password/page.tsx`

**Interfaces:**
- Consumes: `useSearchParams`, `useRouter` (`next/navigation`); `t` (`@/lib/i18n`); `useLocale` (`@/lib/i18n-client`); `getConfig`, `getCachedConfig` (`@/lib/config`). Uses `Suspense` (like the login page) because it reads search params.

- [ ] **Step 1: Create the page**

Create `src/app/reset-password/page.tsx`:

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

function ResetForm() {
  useLocale();
  const router = useRouter();
  const token = useSearchParams().get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [logoUrl, setLogoUrl] = useState(
    () => getCachedConfig()?.logoUrl || "/logo.png"
  );

  useEffect(() => {
    getConfig().then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.png"));
  }, []);

  useEffect(() => {
    if (!token) {
      setTokenValid(false);
      return;
    }
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setTokenValid(!!d.valid))
      .catch(() => setTokenValid(false));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("resetPasswordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("resetPasswordInvalid"));
        setLoading(false);
        return;
      }
      router.replace("/login?reset=1");
    } catch {
      setError(t("resetPasswordInvalid"));
      setLoading(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: "oklch(0.17 0 0 / 0.75)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    borderColor: "var(--border)",
    boxShadow: "var(--shadow-xl)",
  };

  return (
    <div
      className="h-dvh flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
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
        style={cardStyle}
      >
        <div className="flex items-center justify-center pb-1">
          <img src={logoUrl} alt="Logo" className="h-9 w-auto" />
        </div>

        {tokenValid === null ? (
          <p className="text-[13px] text-center" style={{ color: "var(--fg2)" }}>
            {t("resetPasswordCheckingLink")}
          </p>
        ) : tokenValid === false ? (
          <div className="space-y-4 text-center">
            <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
              {t("resetPasswordInvalid")}
            </p>
            <Link
              href="/forgot-password"
              className="inline-block text-[12.5px]"
              style={{ color: "var(--fg2)" }}
            >
              {t("forgotPassword")}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <h1
              className="text-[15px] font-semibold text-center"
              style={{ color: "var(--fg1)" }}
            >
              {t("resetPasswordHeading")}
            </h1>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--fg2)" }}
              >
                {t("resetPasswordNew")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
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
                style={{ color: "var(--fg2)" }}
              >
                {t("resetPasswordConfirm")}
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
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
              disabled={loading}
              className="w-full py-2.5 rounded-[var(--radius)] text-[13px] font-medium disabled:opacity-60 transition-all active:scale-[0.98]"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow:
                  "0 0 20px color-mix(in oklch, var(--accent) 30%, transparent)",
              }}
            >
              {loading ? t("resetPasswordSaving") : t("resetPasswordSubmit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={<div className="h-dvh" style={{ background: "var(--bg)" }} />}
    >
      <ResetForm />
    </Suspense>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/reset-password/page.tsx
git commit -m "feat(ui): add /reset-password page"
```

---

### Task 13: Wire up entry points (login link + login success hint + admin button)

**Files:**
- Modify: `src/app/login/page.tsx` (add "Forgot password?" link gated on `emailConfigured`; show success hint when `?reset=1`)
- Modify: `src/app/admin/users/page.tsx` (add "Send reset email" action)

**Interfaces:**
- Consumes: `ClientConfig.emailConfigured` (Task 6); i18n keys (Task 10); `POST /api/admin/users/[id]/send-reset` (Task 9).

- [ ] **Step 1: Login page — read `emailConfigured` + a reset success flag**

In `src/app/login/page.tsx`, inside `LoginForm`, add near the other `useState` hooks:

```tsx
  const [emailConfigured, setEmailConfigured] = useState(
    () => getCachedConfig()?.emailConfigured ?? false
  );
  const justReset = params.get("reset") === "1";
```

In the existing `getConfig().then((cfg) => { ... })` callback, add:

```tsx
        setEmailConfigured(!!cfg.emailConfigured);
```

- [ ] **Step 2: Login page — success hint above the error slot**

In `src/app/login/page.tsx`, directly before the `{error && (` block, add:

```tsx
        {justReset && (
          <div
            className="text-[12.5px] text-center"
            style={{ color: "var(--fg2)" }}
          >
            {t("resetPasswordSuccess")}
          </div>
        )}
```

- [ ] **Step 3: Login page — "Forgot password?" link under the submit button**

In `src/app/login/page.tsx`, immediately after the closing `</button>` of the submit button (still inside the `<form>`), add:

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

- [ ] **Step 4: Login page — typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Admin users page — import config accessor**

In `src/app/admin/users/page.tsx`, add to the imports:

```tsx
import { getCachedConfig } from "@/lib/config";
```

- [ ] **Step 6: Admin users page — add the send-reset handler**

In `src/app/admin/users/page.tsx`, inside `AdminUsersPage`, after the `handleDelete` function, add:

```tsx
  const emailConfigured = getCachedConfig()?.emailConfigured ?? false;

  async function handleSendReset(u: UserRow) {
    if (!confirm(t("sendResetEmailConfirm", { email: u.email }))) return;
    const res = await fetch(`/api/admin/users/${u.id}/send-reset`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || t("sendResetEmailFailed"));
      return;
    }
    alert(t("sendResetEmailSent", { email: u.email }));
  }

  function canSendReset(u: UserRow): boolean {
    if (!emailConfigured) return false;
    if (u.role === "superadmin") return false;
    if (u.role === "admin" && viewerRole !== "superadmin") return false;
    return true;
  }
```

- [ ] **Step 7: Admin users page — add the button to the action cell**

In `src/app/admin/users/page.tsx`, inside the actions `<div className="flex gap-2">`, after the Edit `<Button>` and before the Delete `<Button>`, add:

```tsx
                    {canSendReset(u) && (
                      <Button
                        variant="ghost"
                        onClick={() => handleSendReset(u)}
                      >
                        {t("sendResetEmail")}
                      </Button>
                    )}
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/login/page.tsx src/app/admin/users/page.tsx
git commit -m "feat(ui): wire forgot-password link and admin send-reset action"
```

---

### Task 14: Documentation + full manual verification (Mailpit)

**Files:**
- Modify: `CLAUDE.md` (add a "Password reset & email" section)

**Interfaces:** none (documentation + manual E2E).

- [ ] **Step 1: Document the feature in `CLAUDE.md`**

In `CLAUDE.md`, after the "Auth & Users" section, add:

```markdown
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
  logo (inline CID, PNG/JPEG only), and app title from `app_settings`. Email
  copy is server-side only (`src/lib/email/templates/`), never in `i18n.ts`.
```

- [ ] **Step 2: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "docs: document password reset & email module"
```

- [ ] **Step 3: Start Mailpit + configure local env**

Ensure Mailpit is running (web UI at `http://localhost:8025`, SMTP on `1025`).
Create/update `.env` (or `.env.local`) with:

```
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM="Cortex Chat <no-reply@example.com>"
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 4: Run the app**

Run: `npm run dev`
Expected: boots with no env-validation error (confirms conditional validation passes with `SMTP_FROM` + `APP_BASE_URL` present).

- [ ] **Step 5: Verify enumeration-safety for an unknown email**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/forgot-password -H 'Content-Type: application/json' -d '{"email":"nobody@example.com"}'
```
Expected: `200`. Confirm in Mailpit (`:8025`) that **no** email arrived for that address.

- [ ] **Step 6: Verify a real reset email is sent + branded**

Trigger a reset for a real, non-superadmin user (via the login page "Forgot password?" link, or curl with that user's email). In Mailpit at `http://localhost:8025`:
Expected: an email titled "Reset your … password" with the logo/wordmark, the accent-colored "Reset password" button, and a `http://localhost:3000/reset-password?token=…` link. Confirm the HTML button color is the brand accent (not black/transparent).

- [ ] **Step 7: Verify the reset completes and sessions are killed**

Open the reset link from the email, set a new password (≥8 chars, matching confirm), submit.
Expected: redirect to `/login?reset=1` showing the success hint. Sign in with the **new** password → works. Confirm any other open session for that user is logged out (its next navigation redirects to `/login`).

- [ ] **Step 8: Verify token single-use + expiry**

Reload the same reset link after using it.
Expected: the page shows the invalid/expired state (`resetPasswordInvalid`) with a "Forgot password?" link.

- [ ] **Step 9: Verify admin send-reset + superadmin exclusion**

As an admin/superadmin, open `/admin/users`. For a regular user, click "Send reset email" → confirm the toast and the email in Mailpit. Confirm the button is **absent** on the superadmin row.

- [ ] **Step 10: Verify the feature-off path**

Stop the app, remove `SMTP_HOST` from env, `npm run dev` again.
Expected: boots fine; the login page shows **no** "Forgot password?" link; `/admin/users` shows **no** "Send reset email" button; `POST /api/admin/users/<id>/send-reset` returns `400`.

---

## Self-Review

Checked the plan against the approved spec (`docs/superpowers/specs/2026-07-21-password-reset-email-design.md`):

- **Spec coverage:** env config + boot validation (T1) · `password_reset_tokens` table (T2) · token lifecycle incl. hashing/TTL/cooldown/single-use (T3, consumed in T7/T8) · email module render/layout/template/transport/send (T4, T5) · reuse DB branding + CID logo + oklch→hex (T4, T5) · forgot-password enumeration-safe route + middleware (T7) · reset-password validate+consume + kill sessions (T8) · admin send-reset with mirrored gating + superadmin 400 (T9) · i18n EN/DE page copy (T10) · forgot/reset pages (T11, T12) · login link + admin button gated on `emailConfigured` (T6, T13) · docs + manual Mailpit E2E covering all security cases (T14). No gaps.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; verification steps use `npm run typecheck` (project convention) + concrete `tsx`/`curl`/browser checks.
- **Type consistency:** `createResetToken`→`{token,expiresAt}`, `findResetTokenUser`→`{id,userId}|null`, `hasRecentResetToken`→`boolean`, `sendPasswordResetEmail({to,userName,token})`, `composePasswordReset(locale,vars)`→`ComposedEmail`, `cssColorToHex(string)`→`string`, `renderEmailLayout(EmailLayoutInput)`→`string`, `isEmailConfigured()`→`boolean`, `ClientConfig.emailConfigured:boolean` — all consistent across producing and consuming tasks.
- **Flagged deviations from spec:** (1) `render.ts` is `escapeHtml` only; templates are type-safe compose functions instead of a `${var}` renderer. (2) added `src/lib/email/color.ts` (oklch→hex) so the DB-default accent renders in mail clients. Both preserve the spec's intent and output.
```
