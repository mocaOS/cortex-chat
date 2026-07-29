import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth/session";
import { getGroupChatKey } from "@/lib/auth/backend-key";
import { getBackendUrl } from "@/lib/backend";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";
import {
  buildResearchQuestions,
  buildResearchSearchQueries,
  buildRevisionMessages,
  buildWriterMessages,
  isUsableAnswer,
  type ResearchFindings,
} from "@/lib/soul-author-prompt";
import {
  getPersonalityLlmConfig,
  streamChatCompletion,
} from "@/lib/personality-llm";

export const dynamic = "force-dynamic";

// Soul Builder, soulweaver architecture: Cortex answers BENIGN research
// questions (each visible as a step in the client's log), then the SOUL.md
// is written via the backend's admin-gated /api/llm/completions with the
// findings inlined. Sending the author meta-prompt as a Cortex ask query
// would trip the backend's prompt-injection defense — never do that.
const Body = z.object({
  prompt: z.string().min(1).max(4000),
  collectionId: z.string().min(1).nullable().optional(),
  // Refine loop: both present = revise the draft instead of starting fresh.
  previousDraft: z.string().max(64_000).optional(),
  refinement: z.string().max(2000).optional(),
});

const ASK_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 20_000;

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

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { prompt, collectionId, previousDraft, refinement } = parsed.data;

  db.insert(usageEvents)
    .values({
      id: newId(),
      userId: ctx.user.id,
      kind: "message",
      collectionId: collectionId ?? null,
      metadata: JSON.stringify({ path: "/api/me/souls/generate" }),
    })
    .run();

  const llm = getPersonalityLlmConfig();
  if (!llm) {
    // Unreachable in practice — BACKEND_ADMIN_API_KEY is validated at boot.
    return NextResponse.json(
      { error: "Personality generation is not configured" },
      { status: 500 }
    );
  }

  const apiUrl = getBackendUrl();
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": resolved.apiKey,
  };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const think = (step: string) => emit({ thinking: step });
      const status = (message: string) =>
        emit({ status: { stage: "researching", message } });

      try {
        const isRevision = !!(previousDraft && refinement);
        const findings: ResearchFindings = { answers: [], snippets: [] };

        // ---- Phase 1: research (skipped on revisions — the draft already
        // carries the grounded specifics).
        if (!isRevision) {
          status("Researching the knowledge base…");

          for (const query of buildResearchSearchQueries(prompt)) {
            if (request.signal.aborted) return controller.close();
            think(`Searching: "${query}"`);
            try {
              const res = await fetch(`${apiUrl}/api/search`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  query,
                  limit: 6,
                  search_type: "hybrid",
                  ...(collectionId ? { collection_id: collectionId } : {}),
                }),
                signal: AbortSignal.any([
                  request.signal,
                  AbortSignal.timeout(SEARCH_TIMEOUT_MS),
                ]),
              });
              const data = await res.json().catch(() => null);
              const results: { content?: string }[] = data?.results ?? [];
              for (const r of results.slice(0, 6)) {
                if (r.content) findings.snippets.push(r.content);
              }
              think(`Found ${results.length} matching passages`);
            } catch {
              think("Search failed — continuing");
            }
          }

          for (const question of buildResearchQuestions(prompt)) {
            if (request.signal.aborted) return controller.close();
            think(`Asking Cortex: ${question}`);
            try {
              const res = await fetch(`${apiUrl}/api/ask`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  question,
                  use_agentic: false,
                  use_graph: true,
                  use_reranking: true,
                  ...(collectionId ? { collection_id: collectionId } : {}),
                }),
                signal: AbortSignal.any([
                  request.signal,
                  AbortSignal.timeout(ASK_TIMEOUT_MS),
                ]),
              });
              const data = await res.json().catch(() => null);
              const answer: string = data?.answer ?? "";
              if (isUsableAnswer(answer)) {
                findings.answers.push({ question, answer });
                think(`Answer: ${answer.replace(/\s+/g, " ").slice(0, 140)}…`);
              } else {
                think("No usable answer for this question — skipping");
              }
            } catch {
              think("Question timed out — continuing");
            }
          }

          think(
            `Research complete: ${findings.answers.length} answers, ${findings.snippets.length} passages`
          );
        }

        // ---- Phase 2: write via the direct LLM.
        if (request.signal.aborted) return controller.close();
        emit({ status: { stage: "generating", message: "Writing the SOUL.md…" } });
        const messages = isRevision
          ? buildRevisionMessages(prompt, previousDraft!, refinement!)
          : buildWriterMessages(prompt, findings);

        await streamChatCompletion(
          llm,
          messages,
          (token) => emit({ content: token }),
          request.signal
        );

        emit({ done: true });
      } catch (err) {
        if (!request.signal.aborted) {
          emit({
            error:
              err instanceof Error
                ? `Generation failed: ${err.message}`
                : "Generation failed",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {}
      }
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

