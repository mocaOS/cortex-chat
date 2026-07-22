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
