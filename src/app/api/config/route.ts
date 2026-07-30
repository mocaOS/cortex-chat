import { NextResponse } from "next/server";
import { getAppSettings, parseStarterPrompts } from "@/lib/settings";
import { resolveLogoUrl } from "@/lib/branding-url";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { isEmailConfigured } from "@/lib/email/config";
import { isRegistrationEnabled } from "@/lib/registration";
import { getSttConfig, getTtsConfig } from "@/lib/voice";
import { getOidcConfig, isOidcOnly } from "@/lib/auth/oidc";

export const dynamic = "force-dynamic";

export function GET() {
  // Branding (accent, title, description, locale, logo) all live in the
  // app_settings table — superadmin-editable at runtime from /admin/settings.
  const settings = getAppSettings();
  const oidc = getOidcConfig();
  return NextResponse.json({
    accentColor: settings.accentColor,
    logoUrl: resolveLogoUrl(settings),
    locale: settings.locale,
    appTitle: settings.appTitle,
    appDescription: settings.appDescription,
    supportUrl: settings.supportUrl,
    supportLabel: settings.supportLabel,
    defaultChatMode: settings.defaultChatMode,
    starterPrompts: parseStarterPrompts(settings.starterPrompts),
    voice: { stt: !!getSttConfig(), tts: !!getTtsConfig() },
    emailConfigured: isEmailConfigured(),
    registrationEnabled: isRegistrationEnabled(),
    oidc: {
      enabled: !!oidc,
      label: oidc?.buttonLabel ?? "",
      only: isOidcOnly(),
    },
    maxUploadBytes: MAX_UPLOAD_BYTES,
  });
}
