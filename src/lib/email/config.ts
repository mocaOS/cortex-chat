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
