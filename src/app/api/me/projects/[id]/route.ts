import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { chatSessions, projects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { forbidDemo } from "@/lib/auth/demo-guard";
import { getUsableAssistant } from "@/lib/souls";
import { publishChannel } from "@/lib/chat-events";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const PatchBody = z.object({
  name: z.string().min(1).max(100).optional(),
  instructions: z.string().max(4000).optional(),
  assistantId: z.string().min(1).nullable().optional(),
  collectionId: z.string().min(1).nullable().optional(),
});

// Project settings are owner-only; members interact through chats.
export async function PATCH(request: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const blocked = forbidDemo(user); // shared demo account — no project edits
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.id)))
    .get();
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.instructions !== undefined)
    patch.instructions = parsed.data.instructions.trim();
  if (parsed.data.assistantId !== undefined) {
    patch.assistantId = parsed.data.assistantId
      ? (getUsableAssistant(user, parsed.data.assistantId)?.id ?? null)
      : null;
  }
  if (parsed.data.collectionId !== undefined)
    patch.collectionId = parsed.data.collectionId;

  db.update(projects).set(patch).where(eq(projects.id, id)).run();
  publishChannel(`project:${id}`, { updatedAt: Date.now(), by: user.id });
  return NextResponse.json({ ok: true });
}

// Deleting a project keeps its chats — they fall back to their authors'
// flat lists. The detach is explicit (not left to the FK action): SQLite
// ALTER TABLE columns on older deployments may lack ON DELETE SET NULL.
export async function DELETE(_: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const blocked = forbidDemo(user);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.id)))
    .get();
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  db.transaction((tx) => {
    tx.update(chatSessions)
      .set({ projectId: null })
      .where(eq(chatSessions.projectId, id))
      .run();
    tx.delete(projects).where(eq(projects.id, id)).run();
  });
  publishChannel(`project:${id}`, { updatedAt: Date.now(), by: user.id });
  return NextResponse.json({ ok: true });
}
