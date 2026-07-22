export type EmailLocale = "en" | "de";

export interface ComposedEmail {
  subject: string;
  previewText: string;
  bodyHtml: string;
  bodyText: string;
}
