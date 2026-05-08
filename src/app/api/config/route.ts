import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/settings";
import { resolveLogoUrl } from "@/lib/branding-url";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

export const dynamic = "force-dynamic";

export function GET() {
  // Accent still comes from env (deploy-level). Title, description, locale,
  // and logo come from the DB (superadmin-editable at runtime).
  const accentColor =
    readEnv("ACCENT_COLOR") ||
    readEnv("NEXT_PUBLIC_ACCENT_COLOR") ||
    "#ff9500";
  const settings = getAppSettings();

  return NextResponse.json({
    accentColor,
    logoUrl: resolveLogoUrl(settings),
    locale: settings.locale,
    appTitle: settings.appTitle,
    appDescription: settings.appDescription,
    maxUploadBytes: MAX_UPLOAD_BYTES,
  });
}

// Indirect env access so Turbopack doesn't inline.
function readEnv(key: string): string | undefined {
  return process.env[key];
}
