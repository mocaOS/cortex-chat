import "server-only";
import type { AppSettings } from "./settings";

function readEnv(key: string): string | undefined {
  return process.env[key];
}

// Single source of truth for "what logo URL does the client get back".
// Priority: custom uploaded logo → env override → empty string (client falls
// back to /logo.svg in the public/ folder).
export function resolveLogoUrl(settings: AppSettings): string {
  if (settings.logoFile) {
    const bust = settings.logoUpdatedAt ? `?v=${settings.logoUpdatedAt}` : "";
    return `/api/branding/logo${bust}`;
  }
  return readEnv("LOGO_URL") || readEnv("NEXT_PUBLIC_LOGO_URL") || "";
}
