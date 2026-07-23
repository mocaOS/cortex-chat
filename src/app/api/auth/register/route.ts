import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { registrations, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { getRequestMeta } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { isRegistrationEnabled } from "@/lib/registration";
import { getAppSettings, parseNotifyRecipients } from "@/lib/settings";
import { isEmailConfigured } from "@/lib/email/config";
import { sendRegistrationPendingNotification } from "@/lib/email/send";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
});

// In-memory per-IP cooldown — a spam floor for this unauthenticated write
// endpoint (same spirit as the forgot-password 60s resend cooldown). Resets on
// restart, and is skipped when no client IP is attributable (e.g. local dev
// without a proxy) — the unique email index is the real integrity guard.
const lastRegistrationByIp = new Map<string, number>();
const COOLDOWN_MS = 60_000;

export async function POST(request: Request) {
  if (!isRegistrationEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { ip } = await getRequestMeta();
  if (ip) {
    if (Date.now() - (lastRegistrationByIp.get(ip) ?? 0) < COOLDOWN_MS) {
      return NextResponse.json(
        { error: "Please wait before trying again." },
        { status: 429 }
      );
    }
    // Arm on every attempt past the gate (not just successful inserts) so
    // duplicate-email probes are metered too.
    if (lastRegistrationByIp.size > 1000) lastRegistrationByIp.clear();
    lastRegistrationByIp.set(ip, Date.now());
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existingUser = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();
  const existingRegistration = db
    .select()
    .from(registrations)
    .where(eq(registrations.email, email))
    .get();
  if (existingUser || existingRegistration) {
    return NextResponse.json(
      { error: "This email is already registered." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    db.insert(registrations).values({ id: newId(), email, passwordHash }).run();
  } catch (err) {
    // Unique-index race between the check above and the insert.
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return NextResponse.json(
        { error: "This email is already registered." },
        { status: 409 }
      );
    }
    // Anything else is a real server error — surface it, don't masquerade as 409.
    Sentry.captureException(err);
    return NextResponse.json({ error: "Registration failed." }, { status: 500 });
  }

  // Best-effort admin notification. The registration is already committed, so a
  // failed or slow send must never surface to the registrant or roll anything
  // back. No SMTP or an empty recipient list ⇒ nothing sent.
  if (isEmailConfigured()) {
    const recipients = parseNotifyRecipients(
      getAppSettings().registrationNotifyEmails
    );
    if (recipients.length > 0) {
      try {
        await sendRegistrationPendingNotification({
          recipients,
          registrantEmail: email,
        });
      } catch (err) {
        Sentry.captureException(err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
