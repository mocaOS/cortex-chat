import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  groups,
  loginEvents,
  sessions,
  usageEvents,
  users,
} from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";
import { createSession, getRequestMeta } from "@/lib/auth/session";
import { getOidcConfig } from "@/lib/auth/oidc";
import {
  exchangeCallback,
  openTransaction,
  OIDC_TXN_COOKIE,
  type OidcIdentity,
} from "@/lib/auth/oidc-flow";

export const dynamic = "force-dynamic";

// Completes the code flow and terminates into the app's own session model:
// validate state/nonce/PKCE, resolve the account, mint a normal sessions row.
// On ANY failure: generic localized error code on /login — IdP error details
// stay in server logs only.
export async function GET(request: NextRequest) {
  const cfg = getOidcConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const fail = (code: string) => {
    const res = NextResponse.redirect(
      new URL(`/login?error=${code}`, cfg.appBaseUrl)
    );
    res.cookies.delete({ name: OIDC_TXN_COOKIE, path: "/api/auth/oidc" });
    return res;
  };

  // Transaction cookie: signed, 10-min TTL, single-use — deleted on every
  // outcome below, so a replayed callback URL finds no verifier and fails.
  const sealed = request.cookies.get(OIDC_TXN_COOKIE)?.value;
  const txn = sealed ? openTransaction(sealed) : null;
  if (!txn) return fail("oidc");

  let identity: OidcIdentity;
  try {
    identity = await exchangeCallback(request.nextUrl.search, txn);
  } catch (err) {
    console.error("[oidc] code exchange failed:", err);
    Sentry.captureException(err);
    return fail("oidc");
  }

  const { ip, userAgent } = await getRequestMeta();
  const superadminEmail =
    process.env.SUPERADMIN_EMAIL?.trim().toLowerCase() ?? "";

  const logAttempt = (opts: {
    userId: string | null;
    email: string;
    success: boolean;
  }) => {
    db.insert(loginEvents)
      .values({
        id: newId(),
        userId: opts.userId,
        emailAttempted: opts.email,
        success: opts.success ? 1 : 0,
        method: "oidc",
        ip,
        userAgent,
      })
      .run();
  };

  // --- Account resolution, in strict order ---------------------------------

  // 1. Durable link: (issuer, sub) pair set on a previous OIDC login.
  let user = db
    .select()
    .from(users)
    .where(
      and(
        eq(users.oidcIssuer, identity.issuer),
        eq(users.oidcSub, identity.sub)
      )
    )
    .get();

  if (user && user.role === "superadmin") {
    // Defense in depth — a superadmin row should never carry an OIDC link.
    logAttempt({ userId: user.id, email: user.email, success: false });
    return fail("oidc_superadmin");
  }

  if (!user) {
    // 2. The superadmin is env-managed and excluded from SSO entirely (the
    // break-glass account must not depend on an external IdP being up).
    if (identity.email && identity.email === superadminEmail) {
      logAttempt({ userId: null, email: identity.email, success: false });
      return fail("oidc_superadmin");
    }

    const byEmail = identity.email
      ? db.select().from(users).where(eq(users.email, identity.email)).get()
      : undefined;

    if (byEmail) {
      if (byEmail.role === "superadmin") {
        logAttempt({ userId: byEmail.id, email: byEmail.email, success: false });
        return fail("oidc_superadmin");
      }
      // 3. Link to an existing account ONLY on a verified email claim — an
      // unverified claim would let anyone who controls the IdP take over an
      // arbitrary local account (the classic SSO account-takeover bug).
      if (!identity.emailVerified) {
        logAttempt({ userId: byEmail.id, email: byEmail.email, success: false });
        return fail("oidc_unverified");
      }
      if (byEmail.oidcSub && byEmail.oidcSub !== identity.sub) {
        // Same verified email, different IdP identity (issuer migration, or a
        // pre-hijack squat being displaced) — allowed, but never silently.
        console.warn(
          `[oidc] re-linking ${byEmail.email} to a different IdP identity (old sub replaced).`
        );
      }
      // Linking is an ownership change: evict every existing session for the
      // account (same rule as password reset), so whoever held it before the
      // link — e.g. an attacker who JIT-squatted this email at the IdP before
      // its real owner first signed in — loses access the moment the verified
      // owner logs in.
      db.transaction((tx) => {
        tx.update(users)
          .set({
            oidcSub: identity.sub,
            oidcIssuer: identity.issuer,
            updatedAt: Date.now(),
          })
          .where(eq(users.id, byEmail.id))
          .run();
        tx.delete(sessions).where(eq(sessions.userId, byEmail.id)).run();
      });
      user = { ...byEmail, oidcSub: identity.sub, oidcIssuer: identity.issuer };
    } else {
      // 4. JIT-provision. Requires an email claim — users.email is the unique
      // human-facing identifier everywhere else in the app.
      if (!identity.email) {
        console.error(
          "[oidc] cannot provision: ID token carries no email claim (check OIDC_SCOPES / IdP claim mapping)."
        );
        return fail("oidc");
      }
      // Resolved by NAME at login time, not boot — the group may be created
      // after the app started. Unset/missing ⇒ group-less (chat blocked until
      // an admin assigns; same UX as an unassigned manual user).
      const groupId = cfg.defaultGroup
        ? db
            .select({ id: groups.id })
            .from(groups)
            .where(eq(groups.name, cfg.defaultGroup))
            .get()?.id ?? null
        : null;
      if (cfg.defaultGroup && !groupId) {
        console.warn(
          `[oidc] OIDC_DEFAULT_GROUP "${cfg.defaultGroup}" does not exist — provisioning group-less user.`
        );
      }
      try {
        user = db
          .insert(users)
          .values({
            id: newId(),
            email: identity.email,
            passwordHash: "", // unusable sentinel — SSO-only account
            username: identity.displayName,
            role: "user",
            groupId,
            oidcSub: identity.sub,
            oidcIssuer: identity.issuer,
          })
          .returning()
          .get();
      } catch (err) {
        // Unique-email race (concurrent first logins) — re-resolve once.
        user = db
          .select()
          .from(users)
          .where(eq(users.email, identity.email))
          .get();
        if (!user) {
          console.error("[oidc] JIT provisioning failed:", err);
          Sentry.captureException(err);
          return fail("oidc");
        }
      }
    }
  }

  await createSession(user.id, { ip, userAgent });
  db.update(users)
    .set({ lastLoginAt: Date.now() })
    .where(eq(users.id, user.id))
    .run();
  logAttempt({ userId: user.id, email: user.email, success: true });
  db.insert(usageEvents)
    .values({
      id: newId(),
      userId: user.id,
      kind: "login",
      metadata: JSON.stringify({ method: "oidc" }),
    })
    .run();

  // Post-login destination is ALWAYS "/" — never a caller-supplied URL.
  const res = NextResponse.redirect(new URL("/", cfg.appBaseUrl));
  res.cookies.delete({ name: OIDC_TXN_COOKIE, path: "/api/auth/oidc" });
  return res;
}
