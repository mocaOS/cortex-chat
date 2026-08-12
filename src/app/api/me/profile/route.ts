import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { forbidDemo } from "@/lib/auth/demo-guard";

export const dynamic = "force-dynamic";

const Body = z.object({
  username: z.string().max(80).optional(),
});

export async function PATCH(request: Request) {
  const { user } = await requireAuth();
  // Shared demo account: the username is visible to all visitors and is
  // interpolated into the analytics context sent upstream.
  const blocked = forbidDemo(user);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: Date.now() };
  if (parsed.data.username !== undefined) patch.username = parsed.data.username;
  db.update(users).set(patch).where(eq(users.id, user.id)).run();
  return NextResponse.json({ ok: true });
}
