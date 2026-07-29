import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { assistants, chatSessions, projects } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { toAssistantSummary } from "@/lib/souls";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// Full soul (with content) for admin export/inspection.
export async function GET(_: Request, ctx: Ctx) {
  let userId: string;
  try {
    userId = (await requireAdmin()).user.id;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const a = db.select().from(assistants).where(eq(assistants.id, id)).get();
  if (!a) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    assistant: { ...toAssistantSummary(a, userId), soul: a.soul },
  });
}

const PatchBody = z.object({
  enabled: z.boolean(),
});

// Enable/disable. For builtins this IS remove/restore — the row persists so
// the boot seeder never resurrects a removed builtin.
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const result = db
    .update(assistants)
    .set({ enabled: parsed.data.enabled ? 1 : 0, updatedAt: Date.now() })
    .where(eq(assistants.id, id))
    .run();
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

// Hard delete — everything except builtins (those are disabled instead, so
// restarts don't re-seed them).
export async function DELETE(_: Request, ctx: Ctx) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const a = db.select().from(assistants).where(eq(assistants.id, id)).get();
  if (!a) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (a.builtinKey) {
    return NextResponse.json(
      { error: "Built-in souls are removed by disabling them" },
      { status: 400 }
    );
  }
  // Detach referencing chats/projects explicitly — older deployments' ALTER
  // TABLE columns may lack the ON DELETE SET NULL action.
  db.transaction((tx) => {
    tx.update(chatSessions)
      .set({ assistantId: null })
      .where(eq(chatSessions.assistantId, id))
      .run();
    tx.update(projects)
      .set({ assistantId: null })
      .where(eq(projects.assistantId, id))
      .run();
    tx.delete(assistants).where(eq(assistants.id, id)).run();
  });
  return NextResponse.json({ ok: true });
}
