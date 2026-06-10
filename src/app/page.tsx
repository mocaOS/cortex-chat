"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { useLocale } from "@/lib/i18n-client";

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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

      const request = {
        question,
        use_agentic: mode === "deep-research",
        use_graph: true,
        use_reranking: true,
        conversation_history: conversationHistory,
        collection_id: settings.collectionId ?? null,
        // Replay the opaque memory blob (or {} on turn 1). The backend returns
        // an updated one via memory_update; we never construct or mutate it.
        conversation_memory: memoryRef.current ?? {},
      };

      const finalize = (finalMessages: ChatMessage[]) => {
        if (sessionId) {
          updateChatMessages(sessionId, finalMessages, memoryRef.current)
            .then(refreshSessions)
            .catch(() => {});
        }
      };

      if (settings.streaming) {
        const controller = new AbortController();
        abortRef.current = controller;

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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, retrieval: [...(m.retrieval || []), info] }
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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, status } : m
                )
              );
            },
            onMemoryUpdate: (memory) => {
              // Store verbatim; persisted with the message on settle and
              // replayed as conversation_memory next turn.
              memoryRef.current = memory;
            },
            onDone: () => {
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
                        content:
                          retryAfterSeconds != null
                            ? t("rateLimited", { seconds: retryAfterSeconds })
                            : t("rateLimitedNoTime"),
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
              ? err.retryAfterSeconds != null
                ? t("rateLimited", { seconds: err.retryAfterSeconds })
                : t("rateLimitedNoTime")
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
