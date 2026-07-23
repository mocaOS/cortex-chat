import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
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

export const dynamic = "force-dynamic";

function serialize() {
  const s = getAppSettings();
  return {
    appTitle: s.appTitle,
    appDescription: s.appDescription,
    cortexAnalyticsTemplate: s.cortexAnalyticsTemplate,
    accentColor: s.accentColor,
    supportUrl: s.supportUrl,
    supportLabel: s.supportLabel,
    registrationNotifyEmails: s.registrationNotifyEmails,
    emailConfigured: isEmailConfigured(),
    locale: s.locale,
    defaultChatMode: s.defaultChatMode,
    hasCustomLogo: s.logoFile !== null,
    logoUrl: resolveLogoUrl(s),
  };
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    settings: serialize(),
    defaults: {
      appTitle: DEFAULT_APP_TITLE,
      appDescription: DEFAULT_APP_DESCRIPTION,
      cortexAnalyticsTemplate: DEFAULT_CORTEX_ANALYTICS_TEMPLATE,
      accentColor: DEFAULT_ACCENT_COLOR,
      supportUrl: DEFAULT_SUPPORT_URL,
      supportLabel: DEFAULT_SUPPORT_LABEL,
      locale: DEFAULT_LOCALE,
      defaultChatMode: DEFAULT_CHAT_MODE,
      registrationNotifyEmails: DEFAULT_REGISTRATION_NOTIFY_EMAILS,
    },
    cortexAnalyticsVariables: CORTEX_ANALYTICS_VARIABLES,
  });
}

// Accept hex (#rgb / #rrggbb), oklch(...), rgb(...), or hsl(...) functions.
// Length-bounded as a defensive measure; the value is injected into a CSS
// custom property via DOM API (not innerHTML), so the XSS surface is null.
const COLOR_REGEX =
  /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(oklch|rgb|rgba|hsl|hsla)\([^)]{1,80}\))$/;

const Body = z.object({
  // Empty string resets to default; null/undefined leaves it unchanged.
  appTitle: z.string().max(120).optional(),
  appDescription: z.string().max(500).optional(),
  cortexAnalyticsTemplate: z.string().max(4000).optional(),
  accentColor: z
    .string()
    .max(100)
    .refine((v) => v === "" || COLOR_REGEX.test(v), {
      message: "Accent color must be a hex, oklch(), rgb(), or hsl() value",
    })
    .optional(),
  // Empty string clears the support link (hides the header button).
  // Otherwise must be an absolute http(s) or mailto URL — it opens in a new tab.
  supportUrl: z
    .string()
    .max(2000)
    .refine((v) => v === "" || /^(https?:\/\/|mailto:)/i.test(v), {
      message: "Support URL must start with http://, https://, or mailto:",
    })
    .optional(),
  supportLabel: z.string().max(120).optional(),
  // Newline/comma-separated recipient list. Validated + normalized in the
  // handler so we can return a 400 that names the offending address.
  registrationNotifyEmails: z.string().max(4000).optional(),
  locale: z.enum(["en", "de"]).optional(),
  defaultChatMode: z.enum(["chat", "deep-research"]).optional(),
});

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
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
  if (locale) setLocale(locale);
  if (defaultChatMode) setDefaultChatMode(defaultChatMode);
  return NextResponse.json({ settings: serialize() });
}
