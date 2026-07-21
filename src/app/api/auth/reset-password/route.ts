import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { passwordResetTokens, sessions, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { findResetTokenUser } from "@/lib/auth/reset-token";

export const dynamic = "force-dynamic";

// Lightweight validity probe so the page can show "expired" state on load.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  return NextResponse.json({ valid: !!token && !!findResetTokenUser(token) });
}

const Body = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
  const match = findResetTokenUser(parsed.data.token);
  if (!match) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 }
    );
  }
  const newHash = await hashPassword(parsed.data.newPassword);
  // Atomic: set the new password, mark the token used, kill all sessions.
  db.transaction((tx) => {
    tx.update(users)
      .set({ passwordHash: newHash, updatedAt: Date.now() })
      .where(eq(users.id, match.userId))
      .run();
    tx.update(passwordResetTokens)
      .set({ usedAt: Date.now() })
      .where(eq(passwordResetTokens.id, match.id))
      .run();
    tx.delete(sessions).where(eq(sessions.userId, match.userId)).run();
  });
  return NextResponse.json({ ok: true });
}
