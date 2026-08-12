import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { chatSessions } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { forbidDemo } from "@/lib/auth/demo-guard";
import { newId } from "@/lib/auth/crypto";
import { getUsableAssistant } from "@/lib/souls";
import { getAccessibleProject } from "@/lib/projects";
import { publishChannel } from "@/lib/chat-events";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireAuth();
  const rows = db
    .select({
      id: chatSessions.id,
      title: chatSessions.title,
      pinned: chatSessions.pinned,
      assistantId: chatSessions.assistantId,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    // Project chats render under their project in the sidebar — the flat
    // list is personal, non-project chats only.
    .where(and(eq(chatSessions.userId, user.id), isNull(chatSessions.projectId)))
    .orderBy(desc(chatSessions.pinned), desc(chatSessions.updatedAt))
    .all();
  return NextResponse.json({ sessions: rows });
}

const Body = z.object({
  id: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
  assistantId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const { user } = await requireAuth();
  // Belt-and-braces: demo chats live in the visitor's browser and the demo
  // client never calls this — but a hand-rolled request must not create
  // server rows that every other visitor would then see.
  const blocked = forbidDemo(user);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  // Only bind souls the caller may actually use — same check the stream
  // route applies per turn.
  const assistantId = parsed.data.assistantId
    ? (getUsableAssistant(user, parsed.data.assistantId)?.id ?? null)
    : null;
  // A chat lands in a project only if the caller is actually a member.
  const projectId = parsed.data.projectId
    ? (getAccessibleProject(user, parsed.data.projectId)?.id ?? null)
    : null;
  const id = parsed.data.id || newId();
  const now = Date.now();
  db.insert(chatSessions)
    .values({
      id,
      userId: user.id,
      title: parsed.data.title ?? "",
      assistantId,
      projectId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  // Sidebar freshness for teammates: a project gained a chat.
  if (projectId) {
    publishChannel(`project:${projectId}`, { updatedAt: now, by: user.id });
  }
  return NextResponse.json({
    id,
    title: parsed.data.title ?? "",
    assistantId,
    projectId,
    createdAt: now,
    updatedAt: now,
  });
}
