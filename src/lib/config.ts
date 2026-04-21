import { setLocale, type Locale } from "./i18n";

interface ClientConfig {
  accentColor: string;
  logoUrl: string;
  locale: string;
  appTitle: string;
  appDescription: string;
}

let cachedConfig: ClientConfig | null = null;

export async function getConfig(): Promise<ClientConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const res = await fetch("/api/config");
    cachedConfig = (await res.json()) as ClientConfig;
  } catch {
    cachedConfig = {
      accentColor: process.env.NEXT_PUBLIC_ACCENT_COLOR || "#ff9500",
      logoUrl: "",
      locale: "en",
      appTitle: "Ask AI",
      appDescription:
        "Ask anything about your knowledge base. Switch to Deep Research for complex multi-step questions.",
    };
  }

  // Apply accent color as CSS variable
  document.documentElement.style.setProperty(
    "--accent",
    cachedConfig!.accentColor
  );

  // Locale is already normalized to "en" | "de" by /api/config.
  const locale: Locale = cachedConfig!.locale === "de" ? "de" : "en";
  setLocale(locale);
  document.documentElement.lang = locale;

  return cachedConfig!;
}
