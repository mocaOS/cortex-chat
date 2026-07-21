import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { isEmailConfigured } from "@/lib/email/config";
import { createResetToken } from "@/lib/auth/reset-token";
import { sendPasswordResetEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_: Request, ctx: Ctx) {
  let callerRole: "admin" | "superadmin";
  try {
    const { user } = await requireAdmin();
    callerRole = user.role as "admin" | "superadmin";
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email is not configured on this server." },
      { status: 400 }
    );
  }

  const { id } = await ctx.params;
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Superadmin password is env-managed — mirror the user-edit route's refusal.
  if (target.role === "superadmin") {
    return NextResponse.json(
      { error: "The superadmin password is managed via env (SUPERADMIN_PASSWORD)." },
      { status: 400 }
    );
  }
  // Admin callers may only reset regular users.
  if (callerRole === "admin" && target.role === "admin") {
    return NextResponse.json(
      { error: "Only the superadmin can reset admin accounts." },
      { status: 403 }
    );
  }

  const { token } = createResetToken(target.id);
  await sendPasswordResetEmail({
    to: target.email,
    userName: target.username || target.email,
    token,
  });
  return NextResponse.json({ ok: true });
}
