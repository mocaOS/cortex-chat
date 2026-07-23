import "server-only";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { readEmailLogo } from "@/lib/branding";
import { getAppBaseUrl } from "./config";
import { sendMail, type OutgoingMail } from "./transport";
import { renderEmailLayout } from "./layout";
import { cssColorToHex } from "./color";
import type { ComposedEmail, EmailLocale } from "./templates/types";
import { composePasswordReset } from "./templates/password-reset";
import { composeAccountApproved } from "./templates/account-approved";
import { composeRegistrationPending } from "./templates/registration-pending";
import * as Sentry from "@sentry/nextjs";

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

// Shared delivery: branded layout + inline logo (CID). PNG/JPEG logos embed
// as-is; SVG/WebP go through the cached PNG derivative (readEmailLogo) — only
// a failed conversion falls back to the text wordmark in the layout.
async function deliverBrandedEmail(
  to: string,
  composed: ComposedEmail,
  branding: Branding
): Promise<void> {
  const attachments: NonNullable<OutgoingMail["attachments"]> = [];
  let logoCid: string | null = null;
  if (branding.settings.logoFile) {
    const logo = await readEmailLogo(branding.settings.logoFile);
    if (logo) {
      attachments.push({
        filename: logo.filename,
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
