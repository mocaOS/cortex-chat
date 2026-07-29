import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMessages, chatSessions } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { canReadChatSession } from "@/lib/projects";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * "Duplicate to continue": copy a readable chat (messages + opaque memory
 * blob + soul + project) into a new session owned by the caller. This is how
 * project members pick up a teammate's thread — the memory blob is
 * client-carried by design, so the copy replays cleanly.
 */
export async function POST(_: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const { id } = await ctx.params;

  const source = db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, id))
    .get();
  if (!source || !canReadChatSession(user, source)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatSessionId, id))
    .orderBy(asc(chatMessages.createdAt))
    .all();

  const now = Date.now();
  const copyId = newId();
  db.transaction((tx) => {
    tx.insert(chatSessions)
      .values({
        id: copyId,
        userId: user.id,
        title: source.title,
        memory: source.memory,
        assistantId: source.assistantId,
        // The copy stays in the project so the team sees the continuation.
        projectId: source.projectId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    let i = 0;
    for (const m of messages) {
      tx.insert(chatMessages)
        .values({
          id: newId(),
          chatSessionId: copyId,
          // Original authorship travels with the copy.
          userId: m.userId,
          role: m.role,
          content: m.content,
          metadata: m.metadata,
          createdAt: now + i,
        })
        .run();
      i++;
    }
  });

  return NextResponse.json({ id: copyId });
}
