import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { requireSuperadmin } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const PatchBody = z.object({
  email: z.string().email().optional(),
  username: z.string().max(80).optional(),
  password: z.string().min(8).optional(),
  groupId: z.string().nullable().optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    await requireSuperadmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const isSuperadmin = row.role === "superadmin";
  if (
    isSuperadmin &&
    (parsed.data.email !== undefined || parsed.data.password !== undefined)
  ) {
    return NextResponse.json(
      {
        error:
          "Superadmin email and password are managed via env. Rotate SUPERADMIN_* to change.",
      },
      { status: 400 }
    );
  }

  const patch: Partial<typeof users.$inferInsert> = {
    updatedAt: Date.now(),
  };
  if (parsed.data.email !== undefined)
    patch.email = parsed.data.email.trim().toLowerCase();
  if (parsed.data.username !== undefined) patch.username = parsed.data.username;
  if (parsed.data.groupId !== undefined) patch.groupId = parsed.data.groupId;
  if (parsed.data.password !== undefined) {
    patch.passwordHash = await hashPassword(parsed.data.password);
  }

  db.update(users).set(patch).where(eq(users.id, id)).run();

  // If password changed, invalidate all existing sessions for this user.
  if (patch.passwordHash) {
    db.delete(sessions).where(eq(sessions.userId, id)).run();
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, ctx: Ctx) {
  try {
    await requireSuperadmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.role === "superadmin") {
    return NextResponse.json(
      { error: "Superadmin cannot be deleted." },
      { status: 400 }
    );
  }
  db.delete(users).where(eq(users.id, id)).run();
  return NextResponse.json({ ok: true });
}
