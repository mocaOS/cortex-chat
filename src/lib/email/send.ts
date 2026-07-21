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
