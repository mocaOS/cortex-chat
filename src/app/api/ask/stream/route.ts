import { NextResponse } from "next/server";
import { getAuth, getRequestMeta } from "@/lib/auth/session";
import { isDemoUser } from "@/lib/demo";
import { getGroupChatKey } from "@/lib/auth/backend-key";
import { getBackendUrl } from "@/lib/backend";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";
import { getAppSettings } from "@/lib/settings";
import {
  injectCortexAnalytics,
  renderCortexAnalytics,
} from "@/lib/cortex-analytics";
import { getUsableAssistant, parseSoulFile } from "@/lib/souls";
import { canReadChatSession, getAccessibleProject } from "@/lib/projects";
import { chatSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  appendLiveTurn,
  endLiveTurn,
  publishChatEvent,
  startLiveTurn,
} from "@/lib/chat-events";
import { fetchUpstreamWithRetry } from "@/lib/upstream-sse";

export const dynamic = "force-dynamic";

// Per-visitor throttle for the shared demo account. Demo visitors all ride
// one group key, so the backend's per-key/per-IP limits can't tell them
// apart (it only ever sees this server's address) — this sliding window is
// the visitor-level control; backend RATE_LIMIT_QPM / the monthly quota
// remain the aggregate backstop. In-memory like the register cooldown:
// per-process, resets on deploy, skipped when no client IP is attributable.
const demoAskWindow = new Map<string, number[]>();
const DEMO_ASK_LIMIT = 5; // messages per window per IP
const DEMO_ASK_WINDOW_MS = 60_000;

function demoRateLimitResponse(ip: string): NextResponse | null {
  if (!ip) return null;
  if (demoAskWindow.size > 5000) demoAskWindow.clear();
  const now = Date.now();
  const recent = (demoAskWindow.get(ip) ?? []).filter(
    (t) => now - t < DEMO_ASK_WINDOW_MS
  );
  if (recent.length >= DEMO_ASK_LIMIT) {
    demoAskWindow.set(ip, recent);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((recent[0] + DEMO_ASK_WINDOW_MS - now) / 1000)
    );
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    );
  }
  recent.push(now);
  demoAskWindow.set(ip, recent);
  return null;
}

/**
 * SSE streaming proxy with per-user key injection.
 *
 * Browsers always send `Accept-Encoding: gzip` and this header cannot be
 * overridden from client-side fetch. When the backend compresses the SSE
 * stream the browser's decompressor buffers chunks until a full gzip block
 * is available, which defeats real-time streaming. We request upstream with
 * `Accept-Encoding: identity` so data arrives uncompressed.
 */
export async function POST(request: Request) {
  const ctx = await getAuth();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = getGroupChatKey(ctx.user);
  if (!resolved) {
    return NextResponse.json(
      { error: "No chat access. Ask an administrator to assign you to a group." },
      { status: 403 }
    );
  }

  if (isDemoUser(ctx.user)) {
    const { ip } = await getRequestMeta();
    const limited = demoRateLimitResponse(ip);
    if (limited) return limited;
  }

  const apiUrl = getBackendUrl();
  const body = await request.text();

  let parsedBody: Record<string, unknown> | null = null;
  try {
    parsedBody = JSON.parse(body);
  } catch {}
  const collectionId =
    typeof parsedBody?.collection_id === "string"
      ? (parsedBody.collection_id as string)
      : null;

  // Soul selection (`assistant_id`) and project context (`project_id`) are
  // chat-app concepts, stripped before the request goes upstream. Both are
  // scope-checked: users can only inject souls they may see and projects
  // they are members of.
  const assistantId =
    typeof parsedBody?.assistant_id === "string"
      ? (parsedBody.assistant_id as string)
      : null;
  const projectId =
    typeof parsedBody?.project_id === "string"
      ? (parsedBody.project_id as string)
      : null;
  // Live-turn relay target (Phase B): the chat session this turn belongs to.
  // Only honored when the caller is actually a member of that chat.
  const sessionId =
    typeof parsedBody?.session_id === "string"
      ? (parsedBody.session_id as string)
      : null;
  let forwardBody = body;
  if (
    parsedBody &&
    ("assistant_id" in parsedBody ||
      "project_id" in parsedBody ||
      "session_id" in parsedBody)
  ) {
    delete parsedBody.assistant_id;
    delete parsedBody.project_id;
    delete parsedBody.session_id;
    forwardBody = JSON.stringify(parsedBody);
  }
  // Relay live turns only for shared project chats — personal chats have no
  // watchers by definition.
  let relaySessionId: string | null = null;
  if (sessionId && projectId) {
    const session = db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .get();
    if (session?.projectId && canReadChatSession(ctx.user, session)) {
      relaySessionId = sessionId;
    }
  }
  let soulBody: string | null = null;
  if (assistantId) {
    const assistant = getUsableAssistant(ctx.user, assistantId);
    if (assistant) soulBody = parseSoulFile(assistant.soul).body || null;
  }
  let projectInstructions: string | null = null;
  if (projectId) {
    const project = getAccessibleProject(ctx.user, projectId);
    if (project?.instructions.trim()) {
      projectInstructions = project.instructions.trim();
    }
  }

  db.insert(usageEvents)
    .values({
      id: newId(),
      userId: ctx.user.id,
      kind: "message",
      collectionId,
      metadata: JSON.stringify({
        path: "/api/ask/stream",
        ...(assistantId ? { assistantId } : {}),
      }),
    })
    .run();

  const rendered = renderCortexAnalytics(
    getAppSettings().cortexAnalyticsTemplate,
    ctx.user
  );
  // All blocks prepend to conversation_history, so inject in reverse of the
  // intended order — final: [analytics, soul, project instructions, …turns].
  // None are persisted to chat_messages nor ever echoed to the browser.
  let upstreamBody = injectCortexAnalytics(forwardBody, projectInstructions);
  upstreamBody = injectCortexAnalytics(upstreamBody, soulBody);
  upstreamBody = injectCortexAnalytics(upstreamBody, rendered);

  // Correlation id: reuse the client's, or mint one. The backend echoes and
  // forwards it to cortex-helper, so all three services log the same id.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const upstream = await fetchUpstreamWithRetry(
      `${apiUrl}/api/ask/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": resolved.apiKey,
          "Accept-Encoding": "identity",
          "X-Request-ID": requestId,
        },
        body: upstreamBody,
      },
      request.signal
    );

    if (!upstream.ok) {
      const errorHeaders: Record<string, string> = {
        "X-Request-ID": requestId,
      };
      // Pass burst rate-limit hints through so the client can honor them.
      const retryAfter = upstream.headers.get("Retry-After");
      if (retryAfter) errorHeaders["Retry-After"] = retryAfter;

      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
        headers: errorHeaders,
      });
    }

    if (!upstream.body) {
      return new Response("No upstream body", { status: 502 });
    }

    // Phase B live-turn relay: tee the answer stream — one branch to the
    // asker unchanged, the other parsed for content tokens and re-published
    // on the chat's bus channel so project members watch the turn live.
    let responseBody = upstream.body;
    if (relaySessionId) {
      const [toClient, toRelay] = upstream.body.tee();
      responseBody = toClient;
      const question =
        typeof parsedBody?.question === "string" ? parsedBody.question : "";
      const byName = ctx.user.username || ctx.user.email;
      relayTurn(relaySessionId, ctx.user.id, byName, question, toRelay);
    }

    return new Response(responseBody, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-ID": requestId,
      },
    });
  } catch (err) {
    console.error("Stream proxy error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Reads the teed answer stream and republishes it as bus events: turn_start
// (with the question, so watchers render it immediately), token frames, and
// turn_done (watchers then refetch the settled, attributed state). Fire and
// forget — a relay failure must never affect the asker's stream.
async function relayTurn(
  sessionId: string,
  byId: string,
  byName: string,
  question: string,
  stream: ReadableStream<Uint8Array>
): Promise<void> {
  const publish = (event: Parameters<typeof publishChatEvent>[1]) =>
    publishChatEvent(sessionId, event);
  // Registry first, so members opening the chat mid-stream get a replay.
  startLiveTurn(sessionId, { by: byId, byName, question });
  publish({
    kind: "turn_start",
    updatedAt: Date.now(),
    by: byId,
    byName,
    question,
  });
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          if (typeof data.content === "string" && data.content) {
            appendLiveTurn(sessionId, data.content);
            publish({
              kind: "token",
              updatedAt: Date.now(),
              by: byId,
              token: data.content,
            });
          }
        } catch {
          // malformed frame — skip
        }
      }
    }
  } catch {
    // asker aborted or upstream dropped — fall through to turn_done
  } finally {
    endLiveTurn(sessionId);
    publish({ kind: "turn_done", updatedAt: Date.now(), by: byId });
  }
}
