import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { groups, registrations, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { isEmailConfigured } from "@/lib/email/config";
import { sendAccountApprovedEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const Body = z.object({ groupId: z.string().nullable() });

export async function POST(request: Request, ctx: Ctx) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const reg = db
    .select()
    .from(registrations)
    .where(eq(registrations.id, id))
    .get();
  if (!reg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const groupId = parsed.data.groupId;
  if (groupId !== null) {
    // FK enforcement is on (PRAGMA foreign_keys) — validate up front for a
    // friendly error instead of a raw constraint failure.
    const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
    if (!group) {
      return NextResponse.json({ error: "Unknown group." }, { status: 400 });
    }
  }

  // Atomic approval: the users insert and the registration delete commit
  // together. Re-check the email inside the transaction — an admin may have
  // created this user manually since the registration came in.
  const userId = newId();
  let emailTaken = false;
  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(users)
      .where(eq(users.email, reg.email))
      .get();
    if (existing) {
      emailTaken = true;
      return;
    }
    tx.insert(users)
      .values({
        id: userId,
        email: reg.email,
        passwordHash: reg.passwordHash,
        role: "user",
        groupId,
      })
      .run();
    tx.delete(registrations).where(eq(registrations.id, reg.id)).run();
  });
  if (emailTaken) {
    return NextResponse.json(
      {
        error:
          "A user with this email already exists. Delete the registration instead.",
      },
      { status: 409 }
    );
  }

  // Best-effort notification — the approval is already committed and a failed
  // send must never roll it back. emailSent tells the admin UI what happened.
  let emailSent = false;
  if (isEmailConfigured()) {
    try {
      await sendAccountApprovedEmail({ to: reg.email, userName: reg.email });
      emailSent = true;
    } catch (err) {
      Sentry.captureException(err);
    }
  }

  return NextResponse.json({ ok: true, emailSent });
}
