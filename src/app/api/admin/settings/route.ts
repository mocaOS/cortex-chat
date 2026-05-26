import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import {
  CORTEX_ANALYTICS_VARIABLES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_TITLE,
  DEFAULT_CORTEX_ANALYTICS_TEMPLATE,
  DEFAULT_LOCALE,
  getAppSettings,
  setLocale,
  setTextSettings,
} from "@/lib/settings";
import { resolveLogoUrl } from "@/lib/branding-url";

export const dynamic = "force-dynamic";

function serialize() {
  const s = getAppSettings();
  return {
    appTitle: s.appTitle,
    appDescription: s.appDescription,
    cortexAnalyticsTemplate: s.cortexAnalyticsTemplate,
    accentColor: s.accentColor,
    locale: s.locale,
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
      locale: DEFAULT_LOCALE,
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
  locale: z.enum(["en", "de"]).optional(),
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
  const { locale, ...text } = parsed.data;
  setTextSettings(text);
  if (locale) setLocale(locale);
  return NextResponse.json({ settings: serialize() });
}
