import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { chatMessages, chatSessions, users } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { forbidDemo } from "@/lib/auth/demo-guard";
import { newId } from "@/lib/auth/crypto";
import { canReadChatSession, getAccessibleProject } from "@/lib/projects";
import { publishChannel, publishChatEvent } from "@/lib/chat-events";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

async function ownedSession(userId: string, id: string) {
  return db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)))
    .get();
}

export async function GET(_: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const { id } = await ctx.params;
  // Author, or member of the project the chat lives in (read-only then —
  // PATCH/DELETE below stay strictly author-only via ownedSession).
  const session = db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, id))
    .get();
  if (!session || !canReadChatSession(user, session)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const messages = db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      metadata: chatMessages.metadata,
      authorId: chatMessages.userId,
      authorEmail: users.email,
      authorUsername: users.username,
    })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.userId))
    .where(eq(chatMessages.chatSessionId, id))
    .orderBy(asc(chatMessages.createdAt))
    .all();
  return NextResponse.json({
    id: session.id,
    title: session.title,
    pinned: session.pinned,
    assistantId: session.assistantId,
    projectId: session.projectId,
    memory: session.memory ? safeParse(session.memory) : undefined,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: messages.map((m) => {
      const meta = safeParse(m.metadata);
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        authorId: m.authorId ?? undefined,
        authorName: m.authorId
          ? m.authorUsername || m.authorEmail || undefined
          : undefined,
        ...meta,
      };
    }),
  });
}

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  // Echoed back by clients after a GET — attribution is server-stamped, so
  // these are accepted but never trusted (dropped before storage).
  authorId: z.unknown().optional(),
  authorName: z.unknown().optional(),
  sources: z.unknown().optional(),
  graphContext: z.unknown().optional(),
  thinking: z.unknown().optional(),
  subQuestions: z.unknown().optional(),
  retrieval: z.unknown().optional(),
  retrievalStats: z.unknown().optional(),
  // "up" | "down" once the user rated the answer — rides in metadata so the
  // thumb state survives reload. The analytics row is written separately by
  // POST /api/me/feedback.
  feedback: z.unknown().optional(),
  isStreaming: z.boolean().optional(),
});

const PatchBody = z.object({
  title: z.string().max(200).optional(),
  messages: z.array(MessageSchema).optional(),
  // Opaque memory blob — stored verbatim as a JSON string, never inspected.
  memory: z.unknown().optional(),
  pinned: z.boolean().optional(),
  // Move between projects (drag & drop): a project id, or null for the
  // personal flat list. Author-only like every write here.
  projectId: z.string().min(1).nullable().optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const blocked = forbidDemo(user); // demo chats are browser-local only
  if (blocked) return blocked;
  const { id } = await ctx.params;
  // Shared project chats are collaborative: any member may continue the
  // thread (messages + memory). Chat administration (title, pin, moving
  // between projects) stays author-only below.
  const session = db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, id))
    .get();
  if (!session || !canReadChatSession(user, session)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAuthor = session.userId === user.id;

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (
    !isAuthor &&
    (parsed.data.title !== undefined ||
      parsed.data.pinned !== undefined ||
      parsed.data.projectId !== undefined)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.title !== undefined) {
    db.update(chatSessions)
      .set({ title: parsed.data.title, updatedAt: Date.now() })
      .where(eq(chatSessions.id, id))
      .run();
  }

  // Pin toggle deliberately does NOT bump updatedAt — pinning must not
  // reorder the recency-grouped part of the sidebar.
  if (parsed.data.pinned !== undefined) {
    db.update(chatSessions)
      .set({ pinned: parsed.data.pinned ? 1 : 0 })
      .where(eq(chatSessions.id, id))
      .run();
  }

  // Project move — organizational like pinning, so no updatedAt bump. Only
  // projects the author is a member of are valid targets.
  if (parsed.data.projectId !== undefined) {
    const target = parsed.data.projectId
      ? (getAccessibleProject(user, parsed.data.projectId)?.id ?? undefined)
      : null;
    if (target !== undefined) {
      db.update(chatSessions)
        .set({ projectId: target })
        .where(eq(chatSessions.id, id))
        .run();
      // Both affected project folders change for teammates.
      const now = Date.now();
      if (session.projectId)
        publishChannel(`project:${session.projectId}`, { updatedAt: now, by: user.id });
      if (target) publishChannel(`project:${target}`, { updatedAt: now, by: user.id });
    } else {
      return NextResponse.json({ error: "Unknown project" }, { status: 400 });
    }
  }

  // Opaque memory blob is stored as a JSON string; absent key = leave as-is.
  const hasMemory = parsed.data.memory !== undefined;
  const memoryValue = hasMemory ? JSON.stringify(parsed.data.memory) : null;

  if (parsed.data.messages) {
    // Replace all messages for this session in a transaction. Fold the memory
    // update in so a settled turn (messages + new memory) persists atomically.
    // Attribution: existing message ids keep their original author; ids the
    // server hasn't seen yet are stamped with the caller (never client data).
    const now = Date.now();
    const msgs = parsed.data.messages;
    db.transaction((tx) => {
      const existingAuthors = new Map(
        tx
          .select({ id: chatMessages.id, userId: chatMessages.userId })
          .from(chatMessages)
          .where(eq(chatMessages.chatSessionId, id))
          .all()
          .map((r) => [r.id, r.userId] as const)
      );
      tx.delete(chatMessages).where(eq(chatMessages.chatSessionId, id)).run();
      let i = 0;
      for (const m of msgs) {
        const {
          id: _id,
          role,
          content,
          isStreaming: _s,
          authorId: _a,
          authorName: _n,
          ...rest
        } = m;
        const messageId = _id || newId();
        tx.insert(chatMessages)
          .values({
            id: messageId,
            chatSessionId: id,
            userId: existingAuthors.get(messageId) ?? user.id,
            role,
            content,
            metadata: JSON.stringify(rest),
            // Preserve ordering even if Date.now() returns the same ms.
            createdAt: now + i,
          })
          .run();
        i++;
      }
      tx.update(chatSessions)
        .set(hasMemory ? { updatedAt: now, memory: memoryValue } : { updatedAt: now })
        .where(eq(chatSessions.id, id))
        .run();
    });
    // Realtime: notify members watching this chat (they refetch on frames
    // not caused by themselves) + the project folder (sidebar previews).
    publishChatEvent(id, { updatedAt: now, by: user.id });
    if (session.projectId) {
      publishChannel(`project:${session.projectId}`, { updatedAt: now, by: user.id });
    }
  } else if (hasMemory) {
    const now = Date.now();
    db.update(chatSessions)
      .set({ memory: memoryValue, updatedAt: now })
      .where(eq(chatSessions.id, id))
      .run();
    publishChatEvent(id, { updatedAt: now, by: user.id });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const blocked = forbidDemo(user);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const session = await ownedSession(user.id, id);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  db.delete(chatSessions).where(eq(chatSessions.id, id)).run();
  if (session.projectId) {
    publishChannel(`project:${session.projectId}`, {
      updatedAt: Date.now(),
      by: user.id,
    });
  }
  return NextResponse.json({ ok: true });
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
