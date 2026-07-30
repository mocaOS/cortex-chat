import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as client from "openid-client";
import { getOidcConfig, type OidcConfig } from "./oidc";

// Protocol plumbing for the OIDC routes: issuer discovery (cached) and the
// short-lived signed transaction cookie that carries PKCE verifier + state +
// nonce across the redirect round trip.

// --- Discovery -----------------------------------------------------------
// Discovery on every login would add an IdP round trip; cache the resolved
// client.Configuration in-process. Failures are not cached.

const DISCOVERY_TTL_MS = 15 * 60 * 1000;

let discovered: {
  key: string;
  config: client.Configuration;
  fetchedAt: number;
} | null = null;

export async function getDiscoveredClient(
  cfg: OidcConfig
): Promise<client.Configuration> {
  const key = `${cfg.issuerUrl}|${cfg.clientId}`;
  if (
    discovered &&
    discovered.key === key &&
    Date.now() - discovered.fetchedAt < DISCOVERY_TTL_MS
  ) {
    return discovered.config;
  }
  // http:// issuers are boot-restricted to localhost (dev Keycloak etc.).
  const insecure = cfg.issuerUrl.startsWith("http://");
  const config = await client.discovery(
    new URL(cfg.issuerUrl),
    cfg.clientId,
    cfg.clientSecret,
    undefined,
    insecure ? { execute: [client.allowInsecureRequests] } : undefined
  );
  discovered = { key, config, fetchedAt: Date.now() };
  return config;
}

// --- Transaction cookie ---------------------------------------------------
// { verifier, state, nonce } signed with an APP_ENCRYPTION_KEY-derived HMAC
// key. httpOnly + signed, 10-min TTL, single-use (deleted on first consume).

export const OIDC_TXN_COOKIE = "oidc_txn";
export const OIDC_TXN_TTL_MS = 10 * 60 * 1000;

export interface OidcTransaction {
  verifier: string;
  state: string;
  nonce: string;
  iat: number;
}

function txnKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is required.");
  // Domain-separated derivation — never use the raw AES key directly for HMAC.
  return createHmac("sha256", Buffer.from(raw, "base64"))
    .update("cortex-chat:oidc-txn:v1")
    .digest();
}

function sign(payload: string): string {
  return createHmac("sha256", txnKey()).update(payload).digest("base64url");
}

export function sealTransaction(txn: OidcTransaction): string {
  const payload = Buffer.from(JSON.stringify(txn)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function openTransaction(sealed: string): OidcTransaction | null {
  const dot = sealed.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = sealed.slice(0, dot);
  const mac = sealed.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const txn = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as OidcTransaction;
    if (
      typeof txn.verifier !== "string" ||
      typeof txn.state !== "string" ||
      typeof txn.nonce !== "string" ||
      typeof txn.iat !== "number" ||
      Date.now() - txn.iat > OIDC_TXN_TTL_MS
    ) {
      return null;
    }
    return txn;
  } catch {
    return null;
  }
}

// --- Authorization URL -----------------------------------------------------

export async function buildLoginRedirect(): Promise<{
  url: URL;
  sealed: string;
} | null> {
  const cfg = getOidcConfig();
  if (!cfg) return null;
  const oidc = await getDiscoveredClient(cfg);

  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return {
    url,
    sealed: sealTransaction({ verifier, state, nonce, iat: Date.now() }),
  };
}

// --- Code exchange ----------------------------------------------------------

export interface OidcIdentity {
  issuer: string; // canonical discovered issuer, not the env string
  sub: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
}

export async function exchangeCallback(
  callbackSearch: string,
  txn: OidcTransaction
): Promise<OidcIdentity> {
  const cfg = getOidcConfig();
  if (!cfg) throw new Error("OIDC not configured");
  const oidc = await getDiscoveredClient(cfg);

  // Rebuild the current URL from the configured redirect URI + the actual
  // query string — request.url behind a reverse proxy may carry the internal
  // host, and the token exchange must present the exact registered redirect.
  const currentUrl = new URL(cfg.redirectUri);
  currentUrl.search = callbackSearch;

  const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
    pkceCodeVerifier: txn.verifier,
    expectedState: txn.state,
    expectedNonce: txn.nonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("ID token has no sub claim");

  const email =
    typeof claims.email === "string" && claims.email.includes("@")
      ? claims.email.trim().toLowerCase()
      : null;
  const displayName =
    (typeof claims.name === "string" && claims.name.trim()) ||
    (typeof claims.preferred_username === "string" &&
      claims.preferred_username.trim()) ||
    "";

  return {
    issuer: oidc.serverMetadata().issuer,
    sub: claims.sub,
    email,
    emailVerified: claims.email_verified === true,
    displayName,
  };
}
