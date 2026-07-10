"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { ChatMessage, ChatSession, Mode, Settings, Source, GraphContext, RetrievalStats } from "@/types";
import { CurrentUser } from "@/types/auth";
import {
  askQuestion,
  askQuestionStream,
  fetchCollections,
  RateLimitError,
} from "@/lib/api";
import {
  listChats,
  getChat,
  createChat,
  updateChatMessages,
  updateChatTitle,
  deleteChat,
} from "@/lib/chatHistory";
import { t } from "@/lib/i18n";
import { rateLimitMessage } from "@/lib/rate-limit-message";
import { useLocale } from "@/lib/i18n-client";

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// The backend emits one `status` event per pipeline step, and in multi-search
// modes (Deep Research / agentic) several steps share a stage and each carry a
// per-step count, e.g. "Found 8 sources" then "Found 7 sources". Shown verbatim
// these read as a regression (8 → 7), making the system look stuck. Accumulate
// the count per stage and substitute the running total back into the backend's
// own message so the wording (and i18n) is preserved: "Found 8" → "Found 15".
//
// `counts` is scoped to a single stream so it resets every turn. We key by
// `stage` so an unrelated later stage that happens to contain a number (e.g.
// reranking) keeps its own counter rather than folding into the search total.
// Digit-based, so it works regardless of UI language; only the first number in
// the message is rewritten, matching the "Found N sources" shape.
function aggregateStatusCount(
  status: { stage: string; message: string },
  counts: Record<string, number>
): { stage: string; message: string } {
  const match = status.message.match(/\d+/);
  if (!match) return status;
  const n = Number(match[0]);
  if (!Number.isFinite(n)) return status;
  const total = (counts[status.stage] ?? 0) + n;
  counts[status.stage] = total;
  // First event for this stage — the per-step number is already the total, so
  // leave the message untouched (also keeps single-search Chat mode identical).
  if (total === n) return status;
  return { ...status, message: status.message.replace(/\d+/, String(total)) };
}

// The multi-search modes also carry per-step counts on the `retrieval` stream:
// the agentic loop emits "Found 8 sources" per search iteration and Chat-mode
// decomposition emits "Found 8 sources for sub-question 2". The UI renders only
// the LATEST retrieval line, so shown verbatim the count jumps around (8 → 7)
// instead of growing. Accumulate the per-step counts across the turn and show a
// localized running total; retrieval lines that don't carry a source count
// (e.g. "Found 3 relevant communities") pass through untouched.
function aggregateRetrievalCount(
  info: string,
  counts: Record<string, number>
): string {
  const match = info.match(/^Found (\d+) sources?\b/i);
  if (!match) return info;
  const total = (counts.sources ?? 0) + Number(match[1]);
  counts.sources = total;
  return t("sourcesFoundSoFar", { count: total });
}

import { getConfig, getCachedConfig } from "@/lib/config";
import { Collection } from "@/types";
import Header from "@/components/Header";
import MessageList from "@/components/MessageList";
import ChatInput from "@/components/ChatInput";
import SourceModal from "@/components/SourceModal";
import SettingsPanel from "@/components/SettingsPanel";
import Sidebar from "@/components/Sidebar";

export default function Home() {
  useLocale();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");
  const [settings, setSettings] = useState<Settings>({
    streaming: true,
    collectionId: null,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [logoUrl, setLogoUrl] = useState(
    () => getCachedConfig()?.logoUrl || "/logo.png"
  );
  const [emptyTitle, setEmptyTitle] = useState<string | undefined>(
    () => getCachedConfig()?.appTitle
  );
  const [emptyDescription, setEmptyDescription] = useState<string | undefined>(
    () => getCachedConfig()?.appDescription
  );
  const [configReady, setConfigReady] = useState(() => !!getCachedConfig());
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleGeneratedRef = useRef<Set<string>>(new Set());
  // Opaque conversation_memory blob for the active session. Held in a ref so
  // the async handleSend always reads the latest value (no stale closure) and
  // so updating it mid-stream doesn't trigger a re-render. Replayed verbatim on
  // each turn, replaced from the memory_update event, persisted with messages.
  const memoryRef = useRef<unknown>(undefined);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await listChats();
      setSessions(list);
    } catch {
      /* leave existing list; 401 handled via /me polling */
    }
  }, []);

  // Load config, auth, collections, sessions on mount.
  useEffect(() => {
    getConfig().then((cfg) => {
      setLogoUrl(cfg.logoUrl || "/logo.png");
      setEmptyTitle(cfg.appTitle);
      setEmptyDescription(cfg.appDescription);
      setConfigReady(true);
    });
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return (await res.json()) as CurrentUser;
      })
      .then((me) => {
        if (me) {
          setCurrentUser(me);
          // Attach the user to browser-side GlitchTip events.
          Sentry.setUser({
            id: me.id,
            email: me.email,
            username: me.username || undefined,
          });
          refreshSessions();
        }
      })
      .catch(() => {});
    fetchCollections()
      .then(setCollections)
      .catch(() => {});
  }, [router, refreshSessions]);

  const handleSignOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }, [router]);

  // Persist messages to the server whenever they settle (not while streaming).
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const hasStreaming = messages.some((m) => m.isStreaming);
    if (hasStreaming) return;
    updateChatMessages(activeSessionId, messages, memoryRef.current)
      .then(refreshSessions)
      .catch(() => {});
  }, [messages, activeSessionId, refreshSessions]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      const session = await getChat(id);
      if (session) {
        setActiveSessionId(id);
        setMessages(session.messages ?? []);
        memoryRef.current = session.memory;
        setIsLoading(false);
      }
    },
    []
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await deleteChat(id);
      await refreshSessions();
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
        memoryRef.current = undefined;
      }
    },
    [activeSessionId, refreshSessions]
  );

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    memoryRef.current = undefined;
    setIsLoading(false);
  }, []);

  const handleSend = useCallback(
    async (question: string) => {
      if (!question.trim() || isLoading) return;

      // Create session if none active
      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await createChat();
        sessionId = created.id;
        setActiveSessionId(sessionId);
        refreshSessions();
      }

      const isFirstMessage = messages.length === 0;

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: question,
      };

      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        sources: [],
        thinking: [],
        subQuestions: [],
        isStreaming: true,
      };

      // Set title from first user message immediately
      if (isFirstMessage && sessionId && !titleGeneratedRef.current.has(sessionId)) {
        titleGeneratedRef.current.add(sessionId);
        updateChatTitle(sessionId, question).then(refreshSessions).catch(() => {});
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      const conversationHistory = messages
        .filter((m) => !m.isStreaming)
        .map((m) => ({ role: m.role, content: m.content }));

      const useAgentic = mode === "deep-research";

      const request = {
        question,
        use_agentic: useAgentic,
        use_graph: true,
        use_reranking: true,
        conversation_history: conversationHistory,
        collection_id: settings.collectionId ?? null,
        // Replay the opaque memory blob (or {} on turn 1). The backend returns
        // an updated one via memory_update; we never construct or mutate it.
        conversation_memory: memoryRef.current ?? {},
      };

      // Agentic deep research is SSE-only upstream: the non-streaming POST
      // /api/ask rejects use_agentic with a 400 (it routinely exceeds the
      // gateway deadline). So force the streaming path for deep research even
      // when the user has toggled streaming off — the toggle only governs the
      // plain chat path.
      const useStreaming = settings.streaming || useAgentic;

      const finalize = (finalMessages: ChatMessage[]) => {
        if (sessionId) {
          updateChatMessages(sessionId, finalMessages, memoryRef.current)
            .then(refreshSessions)
            .catch(() => {});
        }
      };

      // Per-stage running source counts for the live status label and the
      // retrieval progress line, scoped to this turn so they reset on every
      // send. See aggregateStatusCount / aggregateRetrievalCount.
      const statusCounts: Record<string, number> = {};
      const retrievalCounts: Record<string, number> = {};

      if (useStreaming) {
        const controller = new AbortController();
        abortRef.current = controller;

        // Backend v2 (EMIT_DONE_BEFORE_MEMORY) emits `done` (with
        // `pending_memory: true`) BEFORE the post-answer memory compaction, so
        // `memory_update` arrives after we've already finalized + persisted the
        // turn. Track that so the late blob triggers one more persist —
        // otherwise the server-side session keeps the previous turn's memory
        // until the next turn settles (lost entirely on reload/device switch).
        let doneSeen = false;

        await askQuestionStream(
          request,
          {
            onContent: (token) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + token }
                    : m
                )
              );
            },
            onSources: (sources: Source[]) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, sources } : m
                )
              );
            },
            onGraphContext: (graphContext: GraphContext) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, graphContext } : m
                )
              );
            },
            onThinking: (step: string) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, thinking: [...(m.thinking || []), step] }
                    : m
                )
              );
            },
            onSubQuestions: (questions: string[]) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, subQuestions: questions }
                    : m
                )
              );
            },
            onRetrieval: (info: string) => {
              const aggregated = aggregateRetrievalCount(info, retrievalCounts);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, retrieval: [...(m.retrieval || []), aggregated] }
                    : m
                )
              );
            },
            onRetrievalStats: (stats: RetrievalStats) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, retrievalStats: stats }
                    : m
                )
              );
            },
            onStatus: (status) => {
              const aggregated = aggregateStatusCount(status, statusCounts);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, status: aggregated } : m
                )
              );
            },
            onMemoryUpdate: (memory) => {
              // Store verbatim; replayed as conversation_memory next turn.
              memoryRef.current = memory;
              // New event order: when the blob lands after `done`, the turn was
              // already persisted with the stale blob — persist again with the
              // fresh one. (Old order — memory before done — leaves doneSeen
              // false here and the finalize in onDone picks the blob up.)
              if (doneSeen) {
                setMessages((prev) => {
                  finalize(prev);
                  return prev;
                });
              }
            },
            onDone: () => {
              doneSeen = true;
              setMessages((prev) => {
                const updated = prev.map((m) =>
                  m.id === assistantId ? { ...m, isStreaming: false } : m
                );
                finalize(updated);
                return updated;
              });
              setIsLoading(false);
            },
            onError: (error: string) => {
              setMessages((prev) => {
                const updated = prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: `${t("errorPrefix")}: ${error}`,
                        isStreaming: false,
                      }
                    : m
                );
                finalize(updated);
                return updated;
              });
              setIsLoading(false);
            },
            onRateLimited: (retryAfterSeconds) => {
              setMessages((prev) => {
                const updated = prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: rateLimitMessage(retryAfterSeconds),
                        isStreaming: false,
                      }
                    : m
                );
                finalize(updated);
                return updated;
              });
              setIsLoading(false);
            },
            onReconnect: () => {
              // Server is restarting and the request is being resubmitted —
              // clear the partial answer so the regenerated one streams clean.
              // The regenerated answer re-emits its counts from zero, so the
              // running totals must reset too or the replay double-counts.
              for (const k of Object.keys(statusCounts)) delete statusCounts[k];
              for (const k of Object.keys(retrievalCounts)) delete retrievalCounts[k];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: "",
                        sources: [],
                        thinking: [],
                        subQuestions: [],
                        retrieval: [],
                        retrievalStats: undefined,
                        graphContext: undefined,
                        status: undefined,
                        isStreaming: true,
                      }
                    : m
                )
              );
            },
          },
          controller.signal
        ).catch(() => {
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || t("requestCancelled"),
                    isStreaming: false,
                  }
                : m
            );
            finalize(updated);
            return updated;
          });
          setIsLoading(false);
        });
      } else {
        try {
          const data = await askQuestion(request);
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: data.answer,
                    sources: data.sources,
                    graphContext: data.graph_context,
                    isStreaming: false,
                  }
                : m
            );
            finalize(updated);
            return updated;
          });
        } catch (err) {
          const content =
            err instanceof RateLimitError
              ? rateLimitMessage(err.retryAfterSeconds)
              : `${t("errorPrefix")}: ${err instanceof Error ? err.message : t("unknownError")}`;
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content,
                    isStreaming: false,
                  }
                : m
            );
            finalize(updated);
            return updated;
          });
        }
        setIsLoading(false);
      }
    },
    [isLoading, messages, mode, settings, activeSessionId, refreshSessions]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  if (!configReady || !currentUser) {
    return <div className="h-dvh bg-[var(--bg-primary)]" />;
  }

  const hasGroup = !!currentUser.group;

  return (
    <div className="flex flex-col h-dvh max-h-dvh overflow-hidden">
      <Header
        logoUrl={logoUrl}
        onToggleSidebar={() => setSidebarOpen(true)}
      />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={() => {
          handleNewChat();
          setSidebarOpen(false);
        }}
        onDeleteSession={handleDeleteSession}
        logoUrl={logoUrl}
        currentUser={currentUser}
        onSignOut={handleSignOut}
      />

      {hasGroup ? (
        <>
          <main className="flex-1 overflow-hidden relative">
            <MessageList
              messages={messages}
              onSourceClick={setSelectedSource}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
            />
          </main>

          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isLoading={isLoading}
            mode={mode}
            onModeChange={setMode}
            onSettingsClick={() => setShowSettings(!showSettings)}
            collectionName={
              settings.collectionId
                ? collections.find((c) => c.id === settings.collectionId)?.name ?? null
                : null
            }
          />
        </>
      ) : (
        <main className="flex-1 flex items-center justify-center px-6 text-center">
          <p className="max-w-md text-sm text-[var(--text-secondary)]">
            {t("noGroupAssigned")}
          </p>
        </main>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={setSettings}
          collections={collections}
          onClose={() => setShowSettings(false)}
        />
      )}

      {selectedSource && (
        <SourceModal
          source={selectedSource}
          onClose={() => setSelectedSource(null)}
        />
      )}
    </div>
  );
}
