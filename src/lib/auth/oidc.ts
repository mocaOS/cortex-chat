import "server-only";

// Vendor-agnostic SSO via OpenID Connect discovery — pure env config,
// feature-gated like SMTP/voice: unset OIDC_ISSUER_URL = feature invisible
// (no login button, /api/auth/oidc/* answer 404). Works with any compliant
// IdP (Entra ID, ADFS, Okta, Keycloak, Authentik, Zitadel, …); legacy
// LDAP/SAML shops bridge with a thin IdP in front (documented, not built).
//
// This module stays dependency-free (env reads only) so instrumentation.ts
// can import it for boot validation; the actual protocol work (openid-client,
// discovery cache, transaction cookies) lives in ./oidc-flow.ts.

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string; // space-separated, default "openid profile email"
  buttonLabel: string | null; // null → localized "Single Sign-On" fallback
  defaultGroup: string | null; // group NAME for JIT-provisioned users
  appBaseUrl: string; // redirect URI = {appBaseUrl}/api/auth/oidc/callback
  redirectUri: string;
}

function flag(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function getOidcConfig(): OidcConfig | null {
  const issuerUrl = process.env.OIDC_ISSUER_URL?.trim();
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim();
  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  if (!issuerUrl || !clientId || !clientSecret || !appBaseUrl) return null;
  return {
    issuerUrl,
    clientId,
    clientSecret,
    scopes: process.env.OIDC_SCOPES?.trim() || "openid profile email",
    buttonLabel: process.env.OIDC_BUTTON_LABEL?.trim() || null,
    defaultGroup: process.env.OIDC_DEFAULT_GROUP?.trim() || null,
    appBaseUrl,
    redirectUri: `${appBaseUrl}/api/auth/oidc/callback`,
  };
}

export function isOidcEnabled(): boolean {
  return getOidcConfig() !== null;
}

// OIDC_ONLY=true hides the password form and disables password login +
// self-registration. The env-managed superadmin keeps a password backdoor
// (/login?password=1) — the break-glass account must not depend on the IdP.
export function isOidcOnly(): boolean {
  return isOidcEnabled() && flag("OIDC_ONLY");
}

// Boot validation, aggregated into validateRequiredEnv() in instrumentation.ts.
export function validateOidcEnv(): string[] {
  const errors: string[] = [];
  const issuer = process.env.OIDC_ISSUER_URL?.trim();
  if (!issuer) {
    if (flag("OIDC_ONLY")) {
      errors.push("OIDC_ONLY is set but OIDC_ISSUER_URL is not — password login would be the only method anyway. Unset OIDC_ONLY or configure the IdP.");
    }
    return errors;
  }
  if (!/^https:\/\//.test(issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(issuer)) {
    errors.push("OIDC_ISSUER_URL must be https:// (http:// is allowed for localhost dev only).");
  }
  if (!process.env.OIDC_CLIENT_ID?.trim()) {
    errors.push("OIDC_CLIENT_ID is required when OIDC_ISSUER_URL is set.");
  }
  if (!process.env.OIDC_CLIENT_SECRET?.trim()) {
    errors.push("OIDC_CLIENT_SECRET is required when OIDC_ISSUER_URL is set.");
  }
  const base = process.env.APP_BASE_URL;
  if (!base) {
    errors.push("APP_BASE_URL is required when OIDC_ISSUER_URL is set (builds the redirect URI {APP_BASE_URL}/api/auth/oidc/callback).");
  } else if (!/^https?:\/\//.test(base)) {
    errors.push("APP_BASE_URL must start with http:// or https://.");
  }
  return errors;
}
