import "server-only";

// Public demo mode — pure env config, feature-gated like SMTP/voice/OIDC:
// unset DEMO_MODE = feature invisible. When enabled, a shared demo user is
// bootstrapped at boot (see auth/demo-bootstrap.ts), the login form is
// prefilled with its published credentials, its chats are stored in the
// visitor's browser instead of the server, and per-user mutations are
// disabled for it. All other accounts on the instance are unaffected.
//
// This module stays dependency-free (env reads only) so instrumentation.ts
// can import it for boot validation; anything touching next/server lives in
// auth/demo-guard.ts, anything touching the DB in auth/demo-bootstrap.ts.

export const DEFAULT_DEMO_EMAIL = "test@test.com";
export const DEFAULT_DEMO_PASSWORD = "test";

export interface DemoConfig {
  email: string;
  password: string;
  group: string | null; // group NAME to pin the demo user to; null = keep/first
}

function flag(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function isDemoMode(): boolean {
  return flag("DEMO_MODE");
}

export function getDemoConfig(): DemoConfig | null {
  if (!isDemoMode()) return null;
  return {
    email: (process.env.DEMO_EMAIL?.trim() || DEFAULT_DEMO_EMAIL).toLowerCase(),
    password: process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD,
    group: process.env.DEMO_GROUP?.trim() || null,
  };
}

export function isDemoUserEmail(email: string): boolean {
  const cfg = getDemoConfig();
  return cfg !== null && email.trim().toLowerCase() === cfg.email;
}

export function isDemoUser(user: { email: string }): boolean {
  return isDemoUserEmail(user.email);
}

// Boot validation, aggregated into validateRequiredEnv() in instrumentation.ts.
export function validateDemoEnv(): string[] {
  if (!isDemoMode()) return [];
  const errors: string[] = [];
  if (flag("OIDC_ONLY")) {
    errors.push(
      "DEMO_MODE and OIDC_ONLY are mutually exclusive — the demo signs in with the prefilled password form, which OIDC_ONLY hides. Unset one of them."
    );
  }
  const email = process.env.DEMO_EMAIL?.trim() || DEFAULT_DEMO_EMAIL;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("DEMO_EMAIL does not look like a valid email address.");
  }
  const superadmin = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (superadmin && email.toLowerCase() === superadmin) {
    errors.push(
      "DEMO_EMAIL must not equal SUPERADMIN_EMAIL — the demo account is a locked-down role:user account."
    );
  }
  const registration = (process.env.ENABLE_REGISTRATION ?? "").trim().toLowerCase();
  if (registration !== "false" && registration !== "0") {
    console.warn(
      "[env] DEMO_MODE is on and self-registration is still enabled (default). " +
        "Consider ENABLE_REGISTRATION=false on a public demo instance."
    );
  }
  return errors;
}
