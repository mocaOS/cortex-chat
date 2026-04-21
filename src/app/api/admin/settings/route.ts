import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import {
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_TITLE,
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
      locale: DEFAULT_LOCALE,
    },
  });
}

const Body = z.object({
  // Empty string resets to default; null/undefined leaves it unchanged.
  appTitle: z.string().max(120).optional(),
  appDescription: z.string().max(500).optional(),
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
