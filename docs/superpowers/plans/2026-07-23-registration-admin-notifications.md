# Registration Admin Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a free-form, admin-managed list of email addresses whenever a user self-registers and enters the pending-approval queue.

**Architecture:** A new `app_settings` KV key (`registrationNotifyEmails`) holds a normalized, newline-joined recipient list, editable on `/admin/settings`. On a successful `POST /api/auth/register` insert, the route reads and parses the list and sends one branded email per recipient, best-effort — gated by SMTP being configured and the list being non-empty. Reuses the existing email module (templates + branded layout + nodemailer transport); no schema migration, no new dependency.

**Tech Stack:** Next.js 16 (App Router route handlers), TypeScript, Drizzle ORM + better-sqlite3, zod, nodemailer, `@sentry/nextjs`.

## Global Constraints

- **No test framework exists** in this project, and introducing one is a non-goal. Per-task verification is `npm run typecheck` (identical to `npm run lint`; both run `tsc --noEmit`) plus the manual Mailpit verification called out in Tasks 5–6. Do **not** add a test runner or `*.test.ts` files.
- **Server-only config** (`CORTEX_API_URL`, `BACKEND_ADMIN_API_KEY`, `APP_ENCRYPTION_KEY`, SMTP vars) must never be `NEXT_PUBLIC_`-prefixed.
- **Email is entirely feature-gated:** all sends are no-ops unless `SMTP_HOST` is set (`isEmailConfigured()`). When SMTP is on, `APP_BASE_URL` + `SMTP_FROM` are already validated at boot.
- **Email copy is server-side only** — lives in `src/lib/email/templates/*`, never in `i18n.ts`. UI strings (labels/hints) go in `i18n.ts` with both `en` and `de` entries.
- **German UI uses du-form**; keep product terms in English.
- **Validation:** admin routes gate with `requireAdmin()`; validate request bodies with zod. `z.string().email()` is the established email validator in this repo (see the register route).
- **Design system:** MOCA tokens only (`var(--fg1/2/3)`, `var(--bg)`, `var(--card)`, `var(--border)`, `var(--input)`, `var(--ring)`, `var(--radius)`), monospace via `var(--font-mono)`. Match the existing settings-page field styling exactly.
- **Branch:** work happens on `feat/registration-admin-notifications` (already created; the design spec is committed there).
- **Never** log, return, or expose password hashes or decrypted keys.

## File Structure

- `src/lib/settings.ts` (modify) — owns the `registrationNotifyEmails` KV key and the shared `parseNotifyRecipients` tokenizer.
- `src/app/api/admin/settings/route.ts` (modify) — owns validation, normalization, and serialization of the setting for the admin UI.
- `src/lib/email/templates/registration-pending.ts` (create) — owns the EN/DE email copy for the notification.
- `src/lib/email/send.ts` (modify) — owns the high-level `sendRegistrationPendingNotification` delivery function.
- `src/app/api/auth/register/route.ts` (modify) — owns the trigger: fire the notification after a committed registration.
- `src/app/admin/settings/page.tsx` (modify) — owns the admin textarea UI + "email off" hint.
- `src/lib/i18n.ts` (modify) — owns the EN/DE UI strings for the new field.

Dependency order: Task 1 → 2 → 3 → 4 → 5 → 6. Each task's changes typecheck cleanly on their own because every change is additive and each consumer's dependency is introduced in an earlier task.

---

### Task 1: Storage layer — `registrationNotifyEmails` key + tokenizer

**Files:**
- Modify: `src/lib/settings.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `DEFAULT_REGISTRATION_NOTIFY_EMAILS: string` (`""`)
  - `AppSettings.registrationNotifyEmails: string` (raw, newline-joined)
  - `parseNotifyRecipients(raw: string): string[]` — splits on newlines + commas, trims, lowercases, drops blanks, dedupes (order-preserving). The single tokenizer used by both the API validator (Task 2) and the send trigger (Task 5).

- [ ] **Step 1: Add the default constant**

In `src/lib/settings.ts`, find:

```ts
export const DEFAULT_SUPPORT_LABEL = "";
```

Add immediately after it:

```ts
export const DEFAULT_REGISTRATION_NOTIFY_EMAILS = "";
```

- [ ] **Step 2: Register the KV key in `TEXT_KEYS`**

Find:

```ts
const TEXT_KEYS = [
  "appTitle",
  "appDescription",
  "cortexAnalyticsTemplate",
  "accentColor",
  "supportUrl",
  "supportLabel",
] as const;
```

Replace with:

```ts
const TEXT_KEYS = [
  "appTitle",
  "appDescription",
  "cortexAnalyticsTemplate",
  "accentColor",
  "supportUrl",
  "supportLabel",
  "registrationNotifyEmails",
] as const;
```

- [ ] **Step 3: Add the field to the `AppSettings` interface**

Find:

```ts
  supportUrl: string;
  supportLabel: string;
  locale: Locale;
```

Replace with:

```ts
  supportUrl: string;
  supportLabel: string;
  registrationNotifyEmails: string;
  locale: Locale;
```

- [ ] **Step 4: Read the key in `getAppSettings()`**

Find:

```ts
    supportLabel: map.get("supportLabel") || DEFAULT_SUPPORT_LABEL,
    locale: normalizeLocale(map.get(LOCALE_KEY)),
```

Replace with:

```ts
    supportLabel: map.get("supportLabel") || DEFAULT_SUPPORT_LABEL,
    registrationNotifyEmails:
      map.get("registrationNotifyEmails") ||
      DEFAULT_REGISTRATION_NOTIFY_EMAILS,
    locale: normalizeLocale(map.get(LOCALE_KEY)),
```

- [ ] **Step 5: Allow the key through `setTextSettings`**

Find:

```ts
      | "supportUrl"
      | "supportLabel"
    >
  >
```

Replace with:

```ts
      | "supportUrl"
      | "supportLabel"
      | "registrationNotifyEmails"
    >
  >
```

- [ ] **Step 6: Add the `parseNotifyRecipients` tokenizer**

At the **end** of `src/lib/settings.ts` (after the `setLogoFile` function), append:

```ts

// Tokenizer shared by the settings validator and the registration-notify send
// path so the two can never disagree about what counts as a recipient. Splits
// on newlines and commas, trims, lowercases, drops blanks, and dedupes while
// preserving first-seen order.
export function parseNotifyRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\n,]/)) {
    const email = token.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). The new field is additive; every existing `AppSettings` consumer still satisfies the interface.

- [ ] **Step 8: Commit**

```bash
git add src/lib/settings.ts
git commit -m "feat: add registrationNotifyEmails setting + recipient tokenizer"
```

---

### Task 2: Settings API — validate, normalize, serialize

**Files:**
- Modify: `src/app/api/admin/settings/route.ts`

**Interfaces:**
- Consumes: `DEFAULT_REGISTRATION_NOTIFY_EMAILS`, `parseNotifyRecipients` (Task 1); `isEmailConfigured` (`@/lib/email/config`, existing).
- Produces (in the GET response): `settings.registrationNotifyEmails: string`, `settings.emailConfigured: boolean`, `defaults.registrationNotifyEmails: string`. Consumed by the UI (Task 6).

- [ ] **Step 1: Import the new settings exports and the email gate**

Find:

```ts
import {
  CORTEX_ANALYTICS_VARIABLES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_TITLE,
  DEFAULT_CHAT_MODE,
  DEFAULT_CORTEX_ANALYTICS_TEMPLATE,
  DEFAULT_LOCALE,
  DEFAULT_SUPPORT_LABEL,
  DEFAULT_SUPPORT_URL,
  getAppSettings,
  setDefaultChatMode,
  setLocale,
  setTextSettings,
} from "@/lib/settings";
import { resolveLogoUrl } from "@/lib/branding-url";
```

Replace with:

```ts
import {
  CORTEX_ANALYTICS_VARIABLES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_TITLE,
  DEFAULT_CHAT_MODE,
  DEFAULT_CORTEX_ANALYTICS_TEMPLATE,
  DEFAULT_LOCALE,
  DEFAULT_REGISTRATION_NOTIFY_EMAILS,
  DEFAULT_SUPPORT_LABEL,
  DEFAULT_SUPPORT_URL,
  getAppSettings,
  parseNotifyRecipients,
  setDefaultChatMode,
  setLocale,
  setTextSettings,
} from "@/lib/settings";
import { resolveLogoUrl } from "@/lib/branding-url";
import { isEmailConfigured } from "@/lib/email/config";
```

- [ ] **Step 2: Serialize the new fields**

Find:

```ts
    supportLabel: s.supportLabel,
    locale: s.locale,
    defaultChatMode: s.defaultChatMode,
    hasCustomLogo: s.logoFile !== null,
    logoUrl: resolveLogoUrl(s),
  };
```

Replace with:

```ts
    supportLabel: s.supportLabel,
    registrationNotifyEmails: s.registrationNotifyEmails,
    emailConfigured: isEmailConfigured(),
    locale: s.locale,
    defaultChatMode: s.defaultChatMode,
    hasCustomLogo: s.logoFile !== null,
    logoUrl: resolveLogoUrl(s),
  };
```

- [ ] **Step 3: Add the field to the GET `defaults` block**

Find:

```ts
      locale: DEFAULT_LOCALE,
      defaultChatMode: DEFAULT_CHAT_MODE,
    },
    cortexAnalyticsVariables: CORTEX_ANALYTICS_VARIABLES,
```

Replace with:

```ts
      locale: DEFAULT_LOCALE,
      defaultChatMode: DEFAULT_CHAT_MODE,
      registrationNotifyEmails: DEFAULT_REGISTRATION_NOTIFY_EMAILS,
    },
    cortexAnalyticsVariables: CORTEX_ANALYTICS_VARIABLES,
```

- [ ] **Step 4: Add the field to the PATCH body schema**

Find:

```ts
  supportLabel: z.string().max(120).optional(),
  locale: z.enum(["en", "de"]).optional(),
  defaultChatMode: z.enum(["chat", "deep-research"]).optional(),
});
```

Replace with:

```ts
  supportLabel: z.string().max(120).optional(),
  // Newline/comma-separated recipient list. Validated + normalized in the
  // handler so we can return a 400 that names the offending address.
  registrationNotifyEmails: z.string().max(4000).optional(),
  locale: z.enum(["en", "de"]).optional(),
  defaultChatMode: z.enum(["chat", "deep-research"]).optional(),
});
```

- [ ] **Step 5: Validate + normalize in the PATCH handler**

Find:

```ts
  const { locale, defaultChatMode, ...text } = parsed.data;
  setTextSettings(text);
```

Replace with:

```ts
  const { locale, defaultChatMode, ...text } = parsed.data;

  // Validate + normalize the recipient list before it is stored. Uses the same
  // tokenizer as the send path so validation and delivery agree on entries.
  if (text.registrationNotifyEmails !== undefined) {
    const recipients = parseNotifyRecipients(text.registrationNotifyEmails);
    if (recipients.length > 50) {
      return NextResponse.json(
        { error: "Too many notification recipients (maximum 50)." },
        { status: 400 }
      );
    }
    for (const recipient of recipients) {
      if (!z.string().email().safeParse(recipient).success) {
        return NextResponse.json(
          { error: `Invalid email address: ${recipient}` },
          { status: 400 }
        );
      }
    }
    // Persist the cleaned form (trimmed / lowercased / deduped / newline-joined).
    text.registrationNotifyEmails = recipients.join("\n");
  }

  setTextSettings(text);
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/settings/route.ts
git commit -m "feat: validate, normalize, and serialize registrationNotifyEmails in settings API"
```

---

### Task 3: Email template — registration pending notification

**Files:**
- Create: `src/lib/email/templates/registration-pending.ts`

**Interfaces:**
- Consumes: `emailButton` (`../layout`), `escapeHtml` (`../render`), `ComposedEmail` + `EmailLocale` (`./types`) — all existing.
- Produces: `RegistrationPendingVars` interface and `composeRegistrationPending(locale: EmailLocale, vars: RegistrationPendingVars): ComposedEmail`. Consumed by the sender (Task 4).

- [ ] **Step 1: Create the template file**

Create `src/lib/email/templates/registration-pending.ts` with exactly:

```ts
import { emailButton } from "../layout";
import { escapeHtml } from "../render";
import type { ComposedEmail, EmailLocale } from "./types";

export interface RegistrationPendingVars {
  registrantEmail: string;
  reviewUrl: string;
  appTitle: string;
  accentHex: string;
}

const BUILDERS: Record<
  EmailLocale,
  (v: RegistrationPendingVars) => ComposedEmail
> = {
  en: (v) => {
    const email = escapeHtml(v.registrantEmail);
    const app = escapeHtml(v.appTitle);
    return {
      subject: `New account awaiting approval — ${v.appTitle}`,
      previewText: `${v.registrantEmail} registered and is waiting for approval.`,
      bodyHtml:
        `<p style="margin:0 0 12px;">A new account has registered for ${app} and is awaiting approval:</p>` +
        `<p style="margin:0 0 12px;font-weight:600;color:#e7e7e7;">${email}</p>` +
        `<p style="margin:0 0 12px;">Review it to approve or reject the request.</p>` +
        emailButton("Review registrations", v.reviewUrl, v.accentHex) +
        `<p style="margin:12px 0 0;color:#8a8a8a;font-size:12px;">You're receiving this because your address is on the registration notification list.</p>`,
      bodyText:
        `A new account has registered for ${v.appTitle} and is awaiting approval:\n\n` +
        `${v.registrantEmail}\n\n` +
        `Review it to approve or reject the request:\n\n${v.reviewUrl}\n\n` +
        `You're receiving this because your address is on the registration notification list.\n`,
    };
  },
  de: (v) => {
    const email = escapeHtml(v.registrantEmail);
    const app = escapeHtml(v.appTitle);
    return {
      subject: `Neue Registrierung wartet auf Freigabe — ${v.appTitle}`,
      previewText: `${v.registrantEmail} hat sich registriert und wartet auf Freigabe.`,
      bodyHtml:
        `<p style="margin:0 0 12px;">Ein neues Konto hat sich für ${app} registriert und wartet auf Freigabe:</p>` +
        `<p style="margin:0 0 12px;font-weight:600;color:#e7e7e7;">${email}</p>` +
        `<p style="margin:0 0 12px;">Prüfe die Anfrage, um sie freizugeben oder abzulehnen.</p>` +
        emailButton("Registrierungen prüfen", v.reviewUrl, v.accentHex) +
        `<p style="margin:12px 0 0;color:#8a8a8a;font-size:12px;">Du erhältst diese E-Mail, weil deine Adresse auf der Benachrichtigungsliste für Registrierungen steht.</p>`,
      bodyText:
        `Ein neues Konto hat sich für ${v.appTitle} registriert und wartet auf Freigabe:\n\n` +
        `${v.registrantEmail}\n\n` +
        `Prüfe die Anfrage, um sie freizugeben oder abzulehnen:\n\n${v.reviewUrl}\n\n` +
        `Du erhältst diese E-Mail, weil deine Adresse auf der Benachrichtigungsliste für Registrierungen steht.\n`,
    };
  },
};

export function composeRegistrationPending(
  locale: EmailLocale,
  vars: RegistrationPendingVars
): ComposedEmail {
  return (BUILDERS[locale] ?? BUILDERS.en)(vars);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/templates/registration-pending.ts
git commit -m "feat: add registration-pending email template (EN/DE)"
```

---

### Task 4: Sender — `sendRegistrationPendingNotification`

**Files:**
- Modify: `src/lib/email/send.ts`

**Interfaces:**
- Consumes: `composeRegistrationPending` (Task 3); existing module-private `deliverBrandedEmail`, `getBranding`, `getAppBaseUrl`.
- Produces: `sendRegistrationPendingNotification(params: { recipients: string[]; registrantEmail: string }): Promise<void>`. Consumed by the register route (Task 5).

- [ ] **Step 1: Add imports**

Find:

```ts
import { composePasswordReset } from "./templates/password-reset";
import { composeAccountApproved } from "./templates/account-approved";
```

Replace with:

```ts
import { composePasswordReset } from "./templates/password-reset";
import { composeAccountApproved } from "./templates/account-approved";
import { composeRegistrationPending } from "./templates/registration-pending";
import * as Sentry from "@sentry/nextjs";
```

- [ ] **Step 2: Add the sender function**

At the **end** of `src/lib/email/send.ts` (after `sendAccountApprovedEmail`), append:

```ts

// Notify the admin-configured recipient list that a new account is awaiting
// approval. Composes once (shared branding/locale) and delivers to each
// recipient individually via Promise.allSettled — one bad address never blocks
// the others, and the recipient list is not exposed across recipients (no
// shared To/Cc). Rejections are reported, never thrown (best-effort).
export async function sendRegistrationPendingNotification(params: {
  recipients: string[];
  registrantEmail: string;
}): Promise<void> {
  if (params.recipients.length === 0) return;
  const branding = getBranding();
  const composed = composeRegistrationPending(branding.locale, {
    registrantEmail: params.registrantEmail,
    reviewUrl: `${getAppBaseUrl()}/admin/users`,
    appTitle: branding.settings.appTitle,
    accentHex: branding.accentHex,
  });
  const results = await Promise.allSettled(
    params.recipients.map((to) => deliverBrandedEmail(to, composed, branding))
  );
  for (const result of results) {
    if (result.status === "rejected") {
      Sentry.captureException(result.reason);
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email/send.ts
git commit -m "feat: add sendRegistrationPendingNotification delivery"
```

---

### Task 5: Trigger — notify on new registration

**Files:**
- Modify: `src/app/api/auth/register/route.ts`

**Interfaces:**
- Consumes: `getAppSettings` + `parseNotifyRecipients` (Task 1), `isEmailConfigured` (`@/lib/email/config`), `sendRegistrationPendingNotification` (Task 4). `Sentry` is already imported in this file.
- Produces: nothing new (behavioral change only).

- [ ] **Step 1: Add imports**

Find:

```ts
import { isRegistrationEnabled } from "@/lib/registration";
```

Replace with:

```ts
import { isRegistrationEnabled } from "@/lib/registration";
import { getAppSettings, parseNotifyRecipients } from "@/lib/settings";
import { isEmailConfigured } from "@/lib/email/config";
import { sendRegistrationPendingNotification } from "@/lib/email/send";
```

- [ ] **Step 2: Fire the notification after the committed insert**

Find (the tail of the `POST` handler):

```ts
  return NextResponse.json({ ok: true });
}
```

Replace with:

```ts
  // Best-effort admin notification. The registration is already committed, so a
  // failed or slow send must never surface to the registrant or roll anything
  // back. No SMTP or an empty recipient list ⇒ nothing sent.
  if (isEmailConfigured()) {
    const recipients = parseNotifyRecipients(
      getAppSettings().registrationNotifyEmails
    );
    if (recipients.length > 0) {
      try {
        await sendRegistrationPendingNotification({
          recipients,
          registrantEmail: email,
        });
      } catch (err) {
        Sentry.captureException(err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: (Optional) manual backend smoke without UI**

The admin UI for setting recipients arrives in Task 6. To exercise the trigger now, temporarily seed the KV row directly (requires local `data/cortex-chat.db` and SMTP pointed at Mailpit — `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `APP_BASE_URL=http://localhost:3000`):

```bash
sqlite3 data/cortex-chat.db "INSERT INTO app_settings(key,value,updated_at) VALUES('registrationNotifyEmails','admin@example.com',strftime('%s','now')*1000) ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
```

Then `npm run dev`, register a throwaway account at `/register`, and confirm the email appears in Mailpit's web UI (`http://localhost:8025`) with a working "Review registrations" link. Full UI-driven verification is in Task 6, so this step may be skipped.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/register/route.ts
git commit -m "feat: notify admin recipients when a user registers for approval"
```

---

### Task 6: Settings UI + i18n

**Files:**
- Modify: `src/lib/i18n.ts`
- Modify: `src/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: GET `/api/admin/settings` fields `settings.registrationNotifyEmails`, `settings.emailConfigured`, `defaults.registrationNotifyEmails` (Task 2); i18n keys added in this task.
- Produces: nothing downstream.

- [ ] **Step 1: Add EN i18n keys**

In `src/lib/i18n.ts`, find (the **English** block):

```ts
    cortexAnalyticsVariablesHeading: "Available variables",
```

Replace with:

```ts
    cortexAnalyticsVariablesHeading: "Available variables",
    registrationNotifyLabel: "Registration notifications",
    registrationNotifyHint:
      "One email per line. Leave empty to disable. These addresses are notified whenever someone registers and is awaiting approval.",
    registrationNotifyEmailOff:
      "Email is not configured (SMTP_HOST unset), so no notifications will be sent until it is.",
    registrationNotifyPlaceholder: "alice@example.com\nops-team@example.com",
```

- [ ] **Step 2: Add DE i18n keys**

Find (the **German** block):

```ts
    cortexAnalyticsVariablesHeading: "Verfügbare Variablen",
```

Replace with:

```ts
    cortexAnalyticsVariablesHeading: "Verfügbare Variablen",
    registrationNotifyLabel: "Registrierungs-Benachrichtigungen",
    registrationNotifyHint:
      "Eine E-Mail pro Zeile. Leer lassen zum Deaktivieren. Diese Adressen werden benachrichtigt, sobald sich jemand registriert und auf Freigabe wartet.",
    registrationNotifyEmailOff:
      "E-Mail ist nicht konfiguriert (SMTP_HOST fehlt) — es werden keine Benachrichtigungen gesendet, bis das eingerichtet ist.",
    registrationNotifyPlaceholder: "alice@example.com\nops-team@example.com",
```

- [ ] **Step 3: Typecheck the i18n change**

Run: `npm run typecheck`
Expected: PASS. (The `t()` function keys are string-typed; new keys are valid in both locale blocks.)

- [ ] **Step 4: Extend the `Settings` interface (page.tsx)**

In `src/app/admin/settings/page.tsx`, find:

```ts
  locale: Locale;
  defaultChatMode: ChatMode;
  hasCustomLogo: boolean;
  logoUrl: string;
}
```

Replace with:

```ts
  locale: Locale;
  defaultChatMode: ChatMode;
  registrationNotifyEmails: string;
  hasCustomLogo: boolean;
  logoUrl: string;
  emailConfigured: boolean;
}
```

- [ ] **Step 5: Extend the `Defaults` interface**

Find:

```ts
  locale: Locale;
  defaultChatMode: ChatMode;
}
```

Replace with:

```ts
  locale: Locale;
  defaultChatMode: ChatMode;
  registrationNotifyEmails: string;
}
```

- [ ] **Step 6: Add component state**

Find:

```ts
  const [defaultChatMode, setDefaultChatMode] = useState<ChatMode>("chat");
```

Replace with:

```ts
  const [defaultChatMode, setDefaultChatMode] = useState<ChatMode>("chat");
  const [registrationNotifyEmails, setRegistrationNotifyEmails] = useState("");
```

- [ ] **Step 7: Hydrate state in `load()`**

Find:

```ts
      setDefaultChatMode(data.settings.defaultChatMode ?? "chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
```

Replace with:

```ts
      setDefaultChatMode(data.settings.defaultChatMode ?? "chat");
      setRegistrationNotifyEmails(data.settings.registrationNotifyEmails ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
```

- [ ] **Step 8: Add to the `savePatch` parameter type**

Find:

```ts
      supportLabel: string;
      locale: Locale;
      defaultChatMode: ChatMode;
    }>
  ) {
```

Replace with:

```ts
      supportLabel: string;
      registrationNotifyEmails: string;
      locale: Locale;
      defaultChatMode: ChatMode;
    }>
  ) {
```

- [ ] **Step 9: Re-hydrate state in `savePatch`'s success block**

Find:

```ts
      setDefaultChatMode(data.settings.defaultChatMode ?? "chat");
      setI18nLocale(data.settings.locale);
```

Replace with:

```ts
      setDefaultChatMode(data.settings.defaultChatMode ?? "chat");
      setRegistrationNotifyEmails(data.settings.registrationNotifyEmails ?? "");
      setI18nLocale(data.settings.locale);
```

- [ ] **Step 10: Include the field in `handleSubmit`'s payload**

Find:

```ts
    savePatch({
      appTitle,
      appDescription,
      cortexAnalyticsTemplate,
      accentColor,
      supportUrl,
      supportLabel,
      locale,
      defaultChatMode,
    });
```

Replace with:

```ts
    savePatch({
      appTitle,
      appDescription,
      cortexAnalyticsTemplate,
      accentColor,
      supportUrl,
      supportLabel,
      registrationNotifyEmails,
      locale,
      defaultChatMode,
    });
```

- [ ] **Step 11: Render the textarea field**

Find (the end of the Cortex-analytics hint, immediately before the form's button row):

```tsx
              {t("cortexAnalyticsHint")}
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
```

Replace with:

```tsx
              {t("cortexAnalyticsHint")}
            </p>

            <div
              className="pt-2 mt-2 border-t"
              style={{ borderColor: "var(--border)" }}
            />

            <div className="block space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--fg2)" }}
              >
                {t("registrationNotifyLabel")}
              </label>
              <textarea
                value={registrationNotifyEmails}
                onChange={(e) => setRegistrationNotifyEmails(e.target.value)}
                maxLength={4000}
                rows={4}
                placeholder={t("registrationNotifyPlaceholder")}
                className="w-full rounded-[var(--radius)] px-3 py-2 text-[12.5px] outline-none border transition-colors disabled:opacity-60 placeholder:text-[var(--fg3)]"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--input)",
                  color: "var(--fg1)",
                  fontFamily: "var(--font-mono)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--ring)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--input)";
                }}
              />
              <p className="text-[11.5px]" style={{ color: "var(--fg2)" }}>
                {t("registrationNotifyHint")}
              </p>
              {settings && !settings.emailConfigured && (
                <p className="text-[11.5px]" style={{ color: "var(--fg2)" }}>
                  {t("registrationNotifyEmailOff")}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
```

- [ ] **Step 12: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 13: Manual end-to-end verification (Mailpit)**

Environment: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_FROM="Cortex <noreply@localhost>"`, `APP_BASE_URL=http://localhost:3000`, Mailpit running (SMTP `:1025`, web UI `:8025`). Registration is on by default.

Run: `npm run dev`, sign in as an admin, go to `/admin/settings`, then verify each:

1. **Save happy path:** enter two addresses (one per line), Save → success; reload → both persist, lowercased/deduped.
2. **Invalid entry:** add a line `not-an-email`, Save → error names the invalid address; nothing stored (reload shows the previous value).
3. **Notification fires:** with two addresses saved, register a throwaway account at `/register` → both addresses receive the branded email in Mailpit (`http://localhost:8025`); the "Review registrations" button opens `http://localhost:3000/admin/users`.
4. **Empty list:** clear the field, Save; register again → no email sent.
5. **Email off:** stop the app, unset `SMTP_HOST`, restart → the settings field shows the "email off" note; registering sends nothing and returns success with no error.

- [ ] **Step 14: Commit**

```bash
git add src/lib/i18n.ts src/app/admin/settings/page.tsx
git commit -m "feat: admin settings UI for registration notification recipients"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Storage (`registrationNotifyEmails` key, default, `parseNotifyRecipients`) → Task 1.
- Settings API (validate/normalize/serialize, `emailConfigured`) → Task 2.
- Email template (EN/DE, registrant email, review link) → Task 3.
- Sender (`Promise.allSettled`, per-recipient, Sentry) → Task 4.
- Trigger (best-effort after commit, SMTP + non-empty gate) → Task 5.
- Settings UI (textarea, hint, email-off note) + i18n → Task 6.
- Edge cases (no SMTP, empty list, invalid entry, one bad recipient, dedupe/case) → covered by Tasks 2, 4, 5 code and Task 6 Step 13 verification.

**2. Placeholder scan** — no TBD/TODO/"add error handling"/"similar to Task N"; every code step shows complete code.

**3. Type consistency** — `registrationNotifyEmails` (string) and `parseNotifyRecipients` are used identically across Tasks 1/2/5; `composeRegistrationPending` / `RegistrationPendingVars` match between Tasks 3 and 4; `sendRegistrationPendingNotification({ recipients, registrantEmail })` signature matches between Tasks 4 and 5; the GET response fields (`registrationNotifyEmails`, `emailConfigured`) match between Task 2 (producer) and Task 6 (consumer interfaces).

**Result:** no gaps found.
