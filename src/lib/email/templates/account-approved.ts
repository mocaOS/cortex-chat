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
