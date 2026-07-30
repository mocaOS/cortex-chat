import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { assistants, chatSessions, projects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import {
  getUsableAssistant,
  parseSoulFile,
  toAssistantSummary,
} from "@/lib/souls";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// Full soul (including the file content) — used by the export button. Any
// soul the user can chat with can also be exported; portability is the point.
export async function GET(_: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const { id } = await ctx.params;
  const a = getUsableAssistant(user, id);
  if (!a) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    assistant: { ...toAssistantSummary(a, user.id), soul: a.soul },
  });
}

// Edit a personal soul: replace the SOUL.md verbatim and re-derive the
// cached frontmatter columns (name, description, starters, collection).
// Running chats pick the new persona up on their next turn automatically —
// injection reads the row per request.
const PatchBody = z.object({
  content: z.string().min(1).max(64_000),
});

export async function PATCH(request: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const { id } = await ctx.params;
  const owned = db
    .select({ id: assistants.id })
    .from(assistants)
    .where(
      and(
        eq(assistants.id, id),
        eq(assistants.scope, "user"),
        eq(assistants.userId, user.id)
      )
    )
    .get();
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const soul = parseSoulFile(parsed.data.content);
  if (!soul.body) {
    return NextResponse.json(
      { error: "The soul file has no persona content" },
      { status: 400 }
    );
  }
  db.update(assistants)
    .set({
      soul: parsed.data.content,
      name: soul.name ?? "Unnamed soul",
      description: soul.description,
      starters: JSON.stringify(soul.starters),
      collectionId: soul.collectionId,
      updatedAt: Date.now(),
    })
    .where(eq(assistants.id, id))
    .run();
  return NextResponse.json({ ok: true });
}

// Users can delete only their own personal souls. References are detached
// explicitly — older deployments' ALTER TABLE columns may lack the
// ON DELETE SET NULL action.
export async function DELETE(_: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const { id } = await ctx.params;
  const owned = db
    .select({ id: assistants.id })
    .from(assistants)
    .where(
      and(
        eq(assistants.id, id),
        eq(assistants.scope, "user"),
        eq(assistants.userId, user.id)
      )
    )
    .get();
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
