import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { chatSessions, usageEvents } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  rating: z.enum(["up", "down"]),
});

// Records a thumbs rating on an assistant message as a usage_events row
// (kind: "feedback") for the admin analytics. The thumb state itself is
// persisted separately inside the message metadata via PATCH /api/me/chats.
export async function POST(request: Request) {
  const { user } = await requireAuth();
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { sessionId, messageId, rating } = parsed.data;

  // Only accept feedback on the caller's own chats.
  const owned = db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, user.id)))
    .get();
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  db.insert(usageEvents)
    .values({
      id: newId(),
      userId: user.id,
      kind: "feedback",
      metadata: JSON.stringify({ sessionId, messageId, rating }),
    })
    .run();

  return NextResponse.json({ ok: true });
}
