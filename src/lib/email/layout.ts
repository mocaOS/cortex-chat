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
