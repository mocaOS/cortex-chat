import { setLocale, type Locale } from "./i18n";

let cachedConfig: {
  accentColor: string;
  logoUrl: string;
  locale: string;
} | null = null;

export async function getConfig() {
  if (cachedConfig) return cachedConfig;

  try {
    const res = await fetch("/api/config");
    cachedConfig = await res.json();
  } catch {
    cachedConfig = {
      accentColor: process.env.NEXT_PUBLIC_ACCENT_COLOR || "#ff9500",
      logoUrl: process.env.NEXT_PUBLIC_LOGO_URL || "",
      locale: process.env.NEXT_PUBLIC_LOCALE || "en",
    };
  }

  // Apply accent color as CSS variable
  document.documentElement.style.setProperty(
    "--accent",
    cachedConfig!.accentColor
  );

  // Set locale
  const locale = cachedConfig!.locale === "german" ? "de" : "en";
  setLocale(locale as Locale);
  document.documentElement.lang = locale;

  return cachedConfig!;
}
