import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { registrations } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_: Request, ctx: Ctx) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const row = db
    .select()
    .from(registrations)
    .where(eq(registrations.id, id))
    .get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.delete(registrations).where(eq(registrations.id, id)).run();
  return NextResponse.json({ ok: true });
}
