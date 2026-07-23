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
