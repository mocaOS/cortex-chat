import type { Metadata } from "next";
import "./globals.css";
import { getAppSettings } from "@/lib/settings";
import { resolveLogoUrl } from "@/lib/branding-url";
import { setLocale as setI18nLocale } from "@/lib/i18n";
import ConfigBootstrap from "@/components/ConfigBootstrap";

function readEnv(key: string): string | undefined {
  return process.env[key];
}

// Title and description are superadmin-editable via /admin/settings.
export async function generateMetadata(): Promise<Metadata> {
  const { appTitle, appDescription } = getAppSettings();
  return {
    title: appTitle,
    description: appDescription,
  };
}

// Resolve the accent server-side and inject it as an inline CSS variable so
// the first paint of any page (notably /login) already has the correct value.
// /api/config still overrides it client-side for cases where the env differs.
// Default follows the MOCA design-system accent (warm yellow-green).
function resolveAccent(): string {
  return (
    readEnv("ACCENT_COLOR") ||
    readEnv("NEXT_PUBLIC_ACCENT_COLOR") ||
    "oklch(0.79 0.18 70.67)"
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const accent = resolveAccent();
  const settings = getAppSettings();
  const logoUrl = resolveLogoUrl(settings);
  setI18nLocale(settings.locale);

  const initialConfig = {
    accentColor: accent,
    logoUrl,
    locale: settings.locale,
    appTitle: settings.appTitle,
    appDescription: settings.appDescription,
  };

  return (
    <html
      lang={settings.locale}
      className="dark"
      style={{ ["--accent" as string]: accent }}
    >
      <body className="antialiased">
        <ConfigBootstrap config={initialConfig}>{children}</ConfigBootstrap>
      </body>
    </html>
  );
}
