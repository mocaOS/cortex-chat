import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { loginEvents, registrations, usageEvents, users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  getRequestMeta,
} from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const { ip, userAgent } = await getRequestMeta();

  const user = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  const ok =
    !!user && (await verifyPassword(user.passwordHash, parsed.data.password));

  db.insert(loginEvents)
    .values({
      id: newId(),
      userId: user?.id ?? null,
      emailAttempted: email,
      success: ok ? 1 : 0,
      ip,
      userAgent,
    })
    .run();

  if (!ok || !user) {
    // Self-registered but not yet approved? Only reveal the pending status
    // when the password matches — otherwise outsiders could probe emails.
    if (!user) {
      const pending = db
        .select()
        .from(registrations)
        .where(eq(registrations.email, email))
        .get();
      if (
        pending &&
        (await verifyPassword(pending.passwordHash, parsed.data.password))
      ) {
        return NextResponse.json(
          {
            error: "Your account is awaiting approval.",
            code: "pendingApproval",
          },
          { status: 401 }
        );
      }
    }
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  await createSession(user.id, { ip, userAgent });
  db.update(users)
    .set({ lastLoginAt: Date.now() })
    .where(eq(users.id, user.id))
    .run();
  db.insert(usageEvents)
    .values({
      id: newId(),
      userId: user.id,
      kind: "login",
      metadata: "{}",
    })
    .run();

  return NextResponse.json({
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
  });
}
