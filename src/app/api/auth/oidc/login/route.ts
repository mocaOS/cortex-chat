import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getOidcConfig } from "@/lib/auth/oidc";
import {
  buildLoginRedirect,
  OIDC_TXN_COOKIE,
  OIDC_TXN_TTL_MS,
} from "@/lib/auth/oidc-flow";

export const dynamic = "force-dynamic";

// Starts the Authorization Code + PKCE flow: mints verifier/state/nonce into
// a short-lived signed cookie and bounces to the IdP's authorization endpoint.
export async function GET() {
  const cfg = getOidcConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const login = await buildLoginRedirect();
    if (!login) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const res = NextResponse.redirect(login.url);
    res.cookies.set(OIDC_TXN_COOKIE, login.sealed, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/oidc",
      maxAge: OIDC_TXN_TTL_MS / 1000,
    });
    return res;
  } catch (err) {
    // Discovery / IdP reachability failure. Log server-side, never echo the
    // IdP error to the browser (same sanitization rule as the voice proxies).
    console.error("[oidc] login initiation failed:", err);
    Sentry.captureException(err);
    return NextResponse.redirect(new URL("/login?error=oidc", cfg.appBaseUrl));
  }
}
