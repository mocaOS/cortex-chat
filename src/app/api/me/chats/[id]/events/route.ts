import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatSessions } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { canReadChatSession } from "@/lib/projects";
import { subscribeChatEvents } from "@/lib/chat-events";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const HEARTBEAT_MS = 25_000;

/**
 * Realtime change-feed for a chat (EventSource on the client). Emits one
 * frame per settled write by any member — clients refetch the session on
 * frames not caused by themselves. Membership-checked like every read.
 */
export async function GET(request: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const { id } = await ctx.params;
  const session = db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, id))
    .get();
  if (!session || !canReadChatSession(user, session)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          /* stream already closed */
        }
      };
      send(": connected\n\n");

      const unsubscribe = subscribeChatEvents(id, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      // Keep intermediary proxies from timing out the idle stream.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
