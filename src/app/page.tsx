"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ChatMessage, ChatSession, Mode, Settings, Source, GraphContext, RetrievalStats } from "@/types";
import {
  askQuestion,
  askQuestionStream,
  fetchCollections,
} from "@/lib/api";
import {
  getSessions,
  getSession,
  createSession,
  updateSessionMessages,
  updateSessionTitle,
  deleteSession,
} from "@/lib/chatHistory";

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

import { getConfig } from "@/lib/config";
import { Collection } from "@/types";
import Header from "@/components/Header";
import MessageList from "@/components/MessageList";
import ChatInput from "@/components/ChatInput";
import SourceModal from "@/components/SourceModal";
import SettingsPanel from "@/components/SettingsPanel";
import Sidebar from "@/components/Sidebar";

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("deep-research");
  const [settings, setSettings] = useState<Settings>({
    streaming: true,
    collectionId: null,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [logoUrl, setLogoUrl] = useState("/logo.svg");
  const [configReady, setConfigReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleGeneratedRef = useRef<Set<string>>(new Set());

  // Load sessions from localStorage on mount
  useEffect(() => {
    getConfig().then((cfg) => {
      setLogoUrl(cfg.logoUrl || "/logo.svg");
      setConfigReady(true);
    });
    fetchCollections()
      .then(setCollections)
      .catch(() => {});
    setSessions(getSessions());
  }, []);

  // Save messages to localStorage whenever they change (and session exists)
  useEffect(() => {
    if (activeSessionId && messages.length > 0) {
      // Only save non-streaming state
      const hasStreaming = messages.some((m) => m.isStreaming);
      if (!hasStreaming) {
        updateSessionMessages(activeSessionId, messages);
        setSessions(getSessions());
      }
    }
  }, [messages, activeSessionId]);

  const startNewSession = useCallback(() => {
    const id = uid();
    createSession(id);
    setActiveSessionId(id);
    setMessages([]);
    setIsLoading(false);
    setSessions(getSessions());
    return id;
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    const session = getSession(id);
    if (session) {
      setActiveSessionId(id);
      setMessages(session.messages);
      setIsLoading(false);
    }
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      deleteSession(id);
      setSessions(getSessions());
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    },
    [activeSessionId]
  );

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setIsLoading(false);
  }, []);

  const handleSend = useCallback(
    async (question: string) => {
      if (!question.trim() || isLoading) return;

      // Create session if none active
      let sessionId = activeSessionId;
      if (!sessionId) {
        sessionId = uid();
        createSession(sessionId);
        setActiveSessionId(sessionId);
        setSessions(getSessions());
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
        updateSessionTitle(sessionId, question);
        setSessions(getSessions());
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
      };

      const finalize = (finalMessages: ChatMessage[]) => {
        // Save to localStorage
        if (sessionId) {
          updateSessionMessages(sessionId, finalMessages);
          setSessions(getSessions());
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
                        content: `Error: ${error}`,
                        isStreaming: false,
                      }
                    : m
                );
                finalize(updated);
                return updated;
              });
              setIsLoading(false);
            },
          },
          controller.signal
        ).catch(() => {
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || "Request was cancelled.",
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
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
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
    [isLoading, messages, mode, settings, activeSessionId]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  if (!configReady) {
    return <div className="h-dvh bg-[var(--bg-primary)]" />;
  }

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
      />

      <main className="flex-1 overflow-hidden relative">
        <MessageList
          messages={messages}
          onSourceClick={setSelectedSource}
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
