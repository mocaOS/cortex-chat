import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  // Use non-prefixed env vars to avoid Turbopack compile-time inlining.
  // Falls back to NEXT_PUBLIC_ variants for convenience.
  const accentColor =
    readEnv("ACCENT_COLOR") ||
    readEnv("NEXT_PUBLIC_ACCENT_COLOR") ||
    "#ff9500";
  const logoUrl =
    readEnv("LOGO_URL") ||
    readEnv("NEXT_PUBLIC_LOGO_URL") ||
    "";

  const locale = readEnv("LOCALE") || readEnv("NEXT_PUBLIC_LOCALE") || "en";

  return NextResponse.json({ accentColor, logoUrl, locale });
}

// Prevent Turbopack from inlining by using indirect access
function readEnv(key: string): string | undefined {
  return process.env[key];
}
