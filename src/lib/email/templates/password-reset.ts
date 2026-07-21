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
