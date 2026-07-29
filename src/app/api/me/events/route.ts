import { requireAuth } from "@/lib/auth/session";
import { listAccessibleProjects } from "@/lib/projects";
import { subscribeChannel } from "@/lib/chat-events";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * User-scoped realtime feed for sidebar freshness: one EventSource that
 * multiplexes every channel relevant to this user — their own channel, their
 * group's, and every project they can access (membership snapshot at connect
 * time; the client reopens the feed when its project list changes). Frames
 * just say "something changed" — clients refetch their lists.
 */
export async function GET(request: Request) {
  const { user } = await requireAuth();

  const channels = [
    `user:${user.id}`,
    ...(user.groupId ? [`group:${user.groupId}`] : []),
    ...listAccessibleProjects(user).map((p) => `project:${p.id}`),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {}
      };
      send(": connected\n\n");

      const unsubscribers = channels.map((channel) =>
        subscribeChannel(channel, (event) =>
          send(`data: ${JSON.stringify(event)}\n\n`)
        )
      );
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      request.signal.addEventListener(
        "abort",
        () => {
          clearInterval(heartbeat);
          for (const unsubscribe of unsubscribers) unsubscribe();
          try {
            controller.close();
          } catch {}
        },
        { once: true }
      );
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
