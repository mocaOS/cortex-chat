import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
    return;
  }
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // GlitchTip error tracking first, so even boot failures (env validation,
  // migrations) are captured. No-op outside production builds.
  await import("./sentry.server.config");

  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Back-compat: LIBRARY_API_URL and NEXT_PUBLIC_API_URL were renamed to
  // CORTEX_API_URL (server-only — the browser never calls the backend directly,
  // so a NEXT_PUBLIC_ prefix was a misnomer). Mirror the deprecated names onto
  // the new one so the rest of the codebase can read CORTEX_API_URL exclusively.
  if (!process.env.CORTEX_API_URL && process.env.LIBRARY_API_URL) {
    process.env.CORTEX_API_URL = process.env.LIBRARY_API_URL;
    console.warn(
      "[env] LIBRARY_API_URL is deprecated; please rename to CORTEX_API_URL."
    );
  }
  if (!process.env.CORTEX_API_URL && process.env.NEXT_PUBLIC_API_URL) {
    process.env.CORTEX_API_URL = process.env.NEXT_PUBLIC_API_URL;
    console.warn(
      "[env] NEXT_PUBLIC_API_URL is deprecated; please rename to CORTEX_API_URL (server-only)."
    );
  }

  validateRequiredEnv();

  const { runMigrations } = await import("@/lib/db/migrate");
  const { bootstrapSuperadmin } = await import("@/lib/auth/superadmin-bootstrap");
  const { bootstrapDefaultGroup } = await import("@/lib/default-group-bootstrap");
  runMigrations();
  await bootstrapSuperadmin();
  // Fire-and-forget: needs the Cortex backend (to mint the group's chat key),
  // which may still be starting — retries in the background, never blocks boot.
  bootstrapDefaultGroup();
  await migrateLegacyBrandingEnv();
}

// One-time migration: when an older deploy is upgraded, copy the legacy
// branding env vars into the app_settings table on first boot if the DB has
// no value yet. After this the env vars can be removed entirely.
//
// Indirect lookup (process.env[key]) prevents Next.js from inlining the
// NEXT_PUBLIC_* read at build time — otherwise the compiled bundle would
// freeze whatever value was present during `npm run build` and ignore the
// actual runtime env in the container.
async function migrateLegacyBrandingEnv(): Promise<void> {
  const legacyAccent =
    readRuntimeEnv("ACCENT_COLOR") || readRuntimeEnv("NEXT_PUBLIC_ACCENT_COLOR");
  if (!legacyAccent) return;
  const { getAppSettings, setTextSettings, DEFAULT_ACCENT_COLOR } = await import(
    "@/lib/settings"
  );
  const current = getAppSettings();
  if (current.accentColor && current.accentColor !== DEFAULT_ACCENT_COLOR) {
    return; // operator already set it via /admin/settings — leave it.
  }
  setTextSettings({ accentColor: legacyAccent });
  console.warn(
    `[env] Migrated legacy accent color (${legacyAccent}) from env into app_settings. ` +
      "The env var can now be removed; future edits happen via /admin/settings."
  );
}

function readRuntimeEnv(key: string): string | undefined {
  return process.env[key];
}

// Reports request errors from Server Components, route handlers and
// middleware to GlitchTip (App Router instrumentation hook, Next 15+).
export const onRequestError = Sentry.captureRequestError;

// Fail fast on a misconfigured deploy. Each missing/invalid var produces a
// distinct error message so an operator can fix it in one pass.
function validateRequiredEnv(): void {
  const errors: string[] = [];

  if (!process.env.BACKEND_ADMIN_API_KEY) {
    errors.push(
      "BACKEND_ADMIN_API_KEY is required (admin-tier Cortex backend key, e.g. moca_admin_...)."
    );
  }

  const encKey = process.env.APP_ENCRYPTION_KEY;
  if (!encKey) {
    errors.push(
      "APP_ENCRYPTION_KEY is required. Generate with `openssl rand -base64 32`."
    );
  } else if (Buffer.from(encKey, "base64").length !== 32) {
    errors.push(
      "APP_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 random bytes)."
    );
  }

  if (!process.env.SUPERADMIN_EMAIL) {
    errors.push("SUPERADMIN_EMAIL is required to bootstrap the superadmin user.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.SUPERADMIN_EMAIL)) {
    errors.push("SUPERADMIN_EMAIL does not look like a valid email address.");
  }

  if (!process.env.SUPERADMIN_PASSWORD) {
    errors.push("SUPERADMIN_PASSWORD is required to bootstrap the superadmin user.");
  }

  // Email is optional (feature-gated on SMTP_HOST). But if SMTP is configured,
  // the pieces required to send a usable reset email must all be present.
  if (process.env.SMTP_HOST) {
    if (!process.env.SMTP_FROM) {
      errors.push(
        'SMTP_FROM is required when SMTP_HOST is set (e.g. "Cortex Chat <no-reply@example.com>").'
      );
    }
    if (!process.env.APP_BASE_URL) {
      errors.push(
        "APP_BASE_URL is required when SMTP_HOST is set (absolute base URL for reset links, e.g. https://chat.example.com)."
      );
    } else if (!/^https?:\/\//.test(process.env.APP_BASE_URL)) {
      errors.push("APP_BASE_URL must start with http:// or https://.");
    }
  }

  if (errors.length > 0) {
    const header =
      "[env] Cortex Chat refuses to start: required environment is missing or invalid.";
    const body = errors.map((e) => `  - ${e}`).join("\n");
    throw new Error(`${header}\n${body}`);
  }
}
