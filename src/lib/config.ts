import { setLocale, type Locale } from "./i18n";
import { MAX_UPLOAD_BYTES } from "./upload-limits";

export interface ClientConfig {
  accentColor: string;
  logoUrl: string;
  locale: string;
  appTitle: string;
  appDescription: string;
  supportUrl: string;
  supportLabel: string;
  defaultChatMode: "chat" | "deep-research";
  // Admin-curated suggested questions rendered as cards on the empty chat
  // screen; clicking one submits it. Empty array = no cards.
  starterPrompts: string[];
  // Server-side voice endpoints configured? Gates mic + read-aloud buttons.
  voice: { stt: boolean; tts: boolean };
  emailConfigured: boolean;
  registrationEnabled: boolean;
  // SSO (OIDC) — enabled gates the login button; label is the admin-set
  // button text ("" = localized fallback); only = password form hidden.
  oidc: { enabled: boolean; label: string; only: boolean };
  // Public demo mode — the login form prefills these credentials and shows a
  // demo notice. Publishing the password here is the point: it's the shared,
  // deliberately public demo login.
  demo: { enabled: boolean; email: string; password: string };
  maxUploadBytes: number;
}

let cachedConfig: ClientConfig | null = null;

// Seeded from the server-rendered layout so the first client paint already
// has the correct logo, title, locale, etc. — no flash of defaults.
export function seedConfig(cfg: ClientConfig): void {
  cachedConfig = cfg;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--accent", cfg.accentColor);
    document.documentElement.lang = cfg.locale === "de" ? "de" : "en";
  }
  const locale: Locale = cfg.locale === "de" ? "de" : "en";
  setLocale(locale);
}

export function getCachedConfig(): ClientConfig | null {
  return cachedConfig;
}

export async function getConfig(): Promise<ClientConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const res = await fetch("/api/config");
    cachedConfig = (await res.json()) as ClientConfig;
  } catch {
    // Cosmetic fallback if /api/config itself is unreachable — at that point
    // the app is broken anyway (no auth, no chats); accent value is a stub.
    cachedConfig = {
      accentColor: "oklch(0.79 0.18 70.67)",
      logoUrl: "",
      locale: "en",
      appTitle: "Ask Cortex",
      appDescription:
        "Formulate any question that you have about the Contents of this Cortex Knowledge Graph.",
      supportUrl: "",
      supportLabel: "",
      defaultChatMode: "deep-research",
      starterPrompts: [],
      voice: { stt: false, tts: false },
      emailConfigured: false,
      registrationEnabled: false,
      oidc: { enabled: false, label: "", only: false },
      demo: { enabled: false, email: "", password: "" },
      maxUploadBytes: MAX_UPLOAD_BYTES,
    };
  }

  document.documentElement.style.setProperty(
    "--accent",
    cachedConfig!.accentColor
  );

  const locale: Locale = cachedConfig!.locale === "de" ? "de" : "en";
  setLocale(locale);
  document.documentElement.lang = locale;

  return cachedConfig!;
}
