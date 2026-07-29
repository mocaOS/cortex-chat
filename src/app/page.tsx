"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { AssistantSummary, ChatMessage, ChatSession, Mode, ProjectInfo, Settings, Source, GraphContext, RetrievalStats } from "@/types";
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
  setChatPinned,
  setChatProject,
  deleteChat,
} from "@/lib/chatHistory";
import { downloadChatMarkdown } from "@/lib/exportChat";
import { listAssistants } from "@/lib/assistants-client";
import SoulsModal from "@/components/souls/SoulsModal";
import { listProjects, deleteProject } from "@/lib/projects-client";
import ProjectModal from "@/components/projects/ProjectModal";
import ProjectShareModal from "@/components/projects/ProjectShareModal";
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
// (e.g. "Found 3 relevant communities") pass through untouched. Returns null
// for zero-result lines ("Found 0 relevant communities" / "Found 0 entities"):
// they add no information and would replace the running sources total in the
// live line, which reads as if the results vanished.
function aggregateRetrievalCount(
  info: string,
  counts: Record<string, number>
): string | null {
  const found = info.match(/^Found (\d+)\b/i);
  if (found && Number(found[1]) === 0) return null;
  const src = info.match(/^Found (\d+) sources?\b/i);
  if (!src) return info;
  const total = (counts.sources ?? 0) + Number(src[1]);
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
  // Admin-configured starting mode (app_settings.defaultChatMode). Applied on
  // initial load and on every new chat, and puts the default first in the
  // ChatInput toggle; the user can still switch per conversation.
  const [defaultMode, setDefaultMode] = useState<Mode>(
    () => getCachedConfig()?.defaultChatMode ?? "deep-research"
  );
  const modeTouchedRef = useRef(false);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const handleModeChange = useCallback((m: Mode) => {
    modeTouchedRef.current = true;
    setMode(m);
  }, []);
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
  const [starterPrompts, setStarterPrompts] = useState<string[]>(
    () => getCachedConfig()?.starterPrompts ?? []
  );
  const [voice, setVoice] = useState<{ stt: boolean; tts: boolean }>(
    () => getCachedConfig()?.voice ?? { stt: false, tts: false }
  );
  const [configReady, setConfigReady] = useState(() => !!getCachedConfig());
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Souls (assistant personas). The active soul is fixed per chat: chosen on
  // the empty screen, bound at chat creation, replayed per turn as
  // assistant_id (the proxy injects the persona server-side).
  const [assistants, setAssistants] = useState<AssistantSummary[]>([]);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [soulsOpen, setSoulsOpen] = useState(false);
  // Team projects. activeProjectId = project context of the ACTIVE chat
  // (its instructions ride each turn as project_id). Project chats are
  // collaborative: any member can continue any thread, authorship is
  // server-stamped per message.
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<{
    open: boolean;
    project: ProjectInfo | null;
  }>({ open: false, project: null });
  const [shareProject, setShareProject] = useState<ProjectInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleGeneratedRef = useRef<Set<string>>(new Set());
  // Opaque conversation_memory blob for the active session. Held in a ref so
  // the async handleSend always reads the latest value (no stale closure) and
  // so updating it mid-stream doesn't trigger a re-render. Replayed verbatim on
  // each turn, replaced from the memory_update event, persisted with messages.
  const memoryRef = useRef<unknown>(undefined);
  // One-turn snapshot: the blob as it was when the last question was SENT.
  // The blob is server-compacted and can't be rewound, so regenerate (and
  // editing the last question) replays this snapshot instead of the post-turn
  // blob — otherwise the regenerated answer would "remember" the answer it is
  // replacing. After a session load the best available value is the stored
  // blob itself (slightly degraded, but honest).
  const memoryAtSendRef = useRef<unknown>(undefined);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await listChats();
      setSessions(list);
    } catch {
      /* leave existing list; 401 handled via /me polling */
    }
    // Project chats render under their project — refresh those alongside so
    // titles/ordering stay in sync after a settled turn.
    try {
      setProjects(await listProjects());
    } catch {
      /* keep the existing project list */
    }
  }, []);

  const refreshAssistants = useCallback(async () => {
    try {
      setAssistants(await listAssistants());
    } catch {
      /* souls are progressive enhancement — a failed load hides the picker */
    }
  }, []);

  // Load config, auth, collections, sessions on mount.
  useEffect(() => {
    getConfig().then((cfg) => {
      setLogoUrl(cfg.logoUrl || "/logo.png");
      setEmptyTitle(cfg.appTitle);
      setEmptyDescription(cfg.appDescription);
      setStarterPrompts(cfg.starterPrompts ?? []);
      setVoice(cfg.voice ?? { stt: false, tts: false });
      // When config wasn't seeded (direct fetch), apply the admin default —
      // unless the user already toggled the mode by hand.
      const dm = cfg.defaultChatMode ?? "deep-research";
      setDefaultMode(dm);
      if (!modeTouchedRef.current) setMode(dm);
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
          refreshAssistants();
        }
      })
      .catch(() => {});
    fetchCollections()
      .then(setCollections)
      .catch(() => {});
  }, [router, refreshSessions, refreshAssistants]);

  const handleSignOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }, [router]);

  // Set when messages were just replaced by loading a session from the
  // server. The persist-on-settle effect below must skip that change: writing
  // the unchanged messages back would bump the session's updatedAt and
  // reorder the sidebar by "last opened" instead of "last message sent".
  const justLoadedRef = useRef(false);

  // Persist messages to the server whenever they settle (not while streaming).
  useEffect(() => {
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      return;
    }
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
        justLoadedRef.current = true;
        setActiveSessionId(id);
        setMessages(session.messages ?? []);
        memoryRef.current = session.memory;
        memoryAtSendRef.current = session.memory;
        setActiveAssistantId(session.assistantId ?? null);
        setActiveProjectId(session.projectId ?? null);
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
        memoryAtSendRef.current = undefined;
        setActiveAssistantId(null);
        setActiveProjectId(null);
      }
    },
    [activeSessionId, refreshSessions]
  );

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    memoryRef.current = undefined;
    memoryAtSendRef.current = undefined;
    setActiveAssistantId(null);
    setActiveProjectId(null);
    setIsLoading(false);
    // Every new conversation starts in the admin-configured default mode.
    modeTouchedRef.current = false;
    setMode(defaultMode);
  }, [defaultMode]);

  // New chat inside a project: fresh thread that inherits the project's
  // soul and collection scope; created (with projectId) on first send.
  const handleNewChatInProject = useCallback(
    (project: ProjectInfo) => {
      handleNewChat();
      setActiveProjectId(project.id);
      if (project.assistantId) {
        setActiveAssistantId(project.assistantId);
        const soul = assistants.find((a) => a.id === project.assistantId);
        if (soul?.mode) {
          modeTouchedRef.current = true;
          setMode(soul.mode);
        }
      }
      if (project.collectionId !== undefined) {
        setSettings((s) => ({ ...s, collectionId: project.collectionId }));
      }
    },
    [handleNewChat, assistants]
  );

  // Picking a soul on the empty screen. Advisory defaults from the soul file
  // (mode, collection scope) are applied here — the user can still change
  // both before sending.
  const handleSelectAssistant = useCallback(
    (id: string | null) => {
      setActiveAssistantId(id);
      const soul = id ? assistants.find((a) => a.id === id) : null;
      if (soul?.mode) {
        modeTouchedRef.current = true;
        setMode(soul.mode);
      }
      if (soul?.collectionId) {
        setSettings((s) => ({ ...s, collectionId: soul.collectionId }));
      }
    },
    [assistants]
  );

  const handleSend = useCallback(
    // `baseOverride` lets regenerate / edit-and-resend rebuild the thread from
    // a truncated prefix without racing the `messages` state update — the
    // override IS the thread the new turn appends to.
    async (question: string, baseOverride?: ChatMessage[]) => {
      if (!question.trim() || isLoading) return;

      let base = baseOverride ?? messages;

      // Shared project chats are multi-writer: re-fetch right before sending
      // so a teammate's settled turns become the base instead of being
      // clobbered by our stale copy (persistence is a full replace). Their
      // latest memory blob comes along for recall continuity. Regenerate /
      // edit (baseOverride) deliberately operate on the local view.
      if (!baseOverride && activeProjectId && activeSessionId) {
        const fresh = await getChat(activeSessionId).catch(() => null);
        if (fresh?.messages) {
          base = fresh.messages;
          setMessages(fresh.messages);
          memoryRef.current = fresh.memory ?? memoryRef.current;
        }
      }

      // Create session if none active — bound to the chosen soul/project.
      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await createChat(
          undefined,
          undefined,
          activeAssistantId,
          activeProjectId
        );
        sessionId = created.id;
        setActiveSessionId(sessionId);
        refreshSessions();
      }

      const isFirstMessage = base.length === 0;

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

      setMessages([...base, userMsg, assistantMsg]);
      setIsLoading(true);

      const conversationHistory = base
        .filter((m) => !m.isStreaming)
        .map((m) => ({ role: m.role, content: m.content }));

      const useAgentic = mode === "deep-research";

      // Snapshot the blob being replayed this turn — regenerate / edit-last
      // restore it so the redo doesn't "remember" the answer it replaces.
      memoryAtSendRef.current = memoryRef.current;

      const request = {
        question,
        use_agentic: useAgentic,
        use_graph: true,
        use_reranking: true,
        conversation_history: conversationHistory,
        collection_id: settings.collectionId ?? null,
        // Soul persona + project context — scope-checked and injected
        // server-side by the proxy, stripped before going upstream.
        assistant_id: activeAssistantId,
        project_id: activeProjectId,
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
              if (aggregated === null) return; // zero-result line — keep the current one
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
              // Zero-result labels ("Found 0 relevant communities") confuse
              // more than they inform — keep the previous label instead.
              // (When the stage already has a running total, aggregation has
              // rewritten the 0 to that total and this never triggers.)
              if (/^Found 0\b/i.test(aggregated.message)) return;
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
    [isLoading, messages, mode, settings, activeSessionId, activeAssistantId, activeProjectId, refreshSessions]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Re-ask the last question: drop the last exchange, restore the pre-turn
  // memory snapshot, resend. New X-Request-ID (new user action) — unlike the
  // shutdown-reconnect replay, which reuses the id.
  const handleRegenerate = useCallback(() => {
    if (isLoading) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;
    memoryRef.current = memoryAtSendRef.current;
    handleSend(messages[lastUserIdx].content, messages.slice(0, lastUserIdx));
  }, [messages, isLoading, handleSend]);

  // Edit a user message and resend: forks the thread at that point (everything
  // after is dropped). Editing the LAST question replays the pre-turn memory
  // snapshot; editing an earlier one resets memory to {} — the opaque blob
  // can't be rewound further back, so cross-turn recall restarts from there.
  const handleEditResend = useCallback(
    (messageId: string, newContent: string) => {
      if (isLoading || !newContent.trim()) return;
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1 || messages[idx].role !== "user") return;
      const isLastUser = !messages
        .slice(idx + 1)
        .some((m) => m.role === "user");
      memoryRef.current = isLastUser ? memoryAtSendRef.current : undefined;
      handleSend(newContent, messages.slice(0, idx));
    },
    [messages, isLoading, handleSend]
  );

  // Thumbs rating: stamp the message (persisted via the settle effect) and
  // fire the analytics event. Best-effort — a failed event never blocks the UI.
  const handleFeedback = useCallback(
    (messageId: string, rating: "up" | "down") => {
      if (!activeSessionId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m))
      );
      fetch("/api/me/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId, messageId, rating }),
      }).catch(() => {});
    },
    [activeSessionId]
  );

  const handleTogglePin = useCallback(
    async (id: string, pinned: boolean) => {
      await setChatPinned(id, pinned).catch(() => {});
      refreshSessions();
    },
    [refreshSessions]
  );

  // Export a chat as a Markdown download. Fetches the full session so it
  // works from the sidebar for chats that aren't currently open.
  const handleExportSession = useCallback(async (id: string) => {
    const session = await getChat(id).catch(() => null);
    if (session) downloadChatMarkdown(session);
  }, []);

  // Realtime for shared project chats: subscribe to the chat's SSE
  // change-feed and refetch on frames caused by OTHER members. EventSource
  // auto-reconnects on drops. Suspended while a local turn streams (the
  // refetch would clobber the in-flight assistant message).
  useEffect(() => {
    if (!activeSessionId || !activeProjectId || isLoading || !currentUser) return;
    const sessionId = activeSessionId;
    const userId = currentUser.id;

    const adopt = async () => {
      const fresh = await getChat(sessionId).catch(() => null);
      if (!fresh?.messages) return;
      setMessages((prev) => {
        // Only adopt server state that actually advanced — last id + count
        // comparison keeps this cheap and avoids pointless re-renders.
        if (
          fresh.messages!.length === prev.length &&
          fresh.messages![fresh.messages!.length - 1]?.id === prev[prev.length - 1]?.id
        ) {
          return prev;
        }
        justLoadedRef.current = true;
        memoryRef.current = fresh.memory ?? memoryRef.current;
        return fresh.messages!;
      });
    };

    const es = new EventSource(`/api/me/chats/${sessionId}/events`);
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { by?: string };
        if (event.by !== userId) adopt();
      } catch {}
    };
    // Catch anything missed while the tab was hidden or the stream was down.
    adopt();
    return () => es.close();
  }, [activeSessionId, activeProjectId, isLoading, currentUser]);

  // Drag & drop: move an own chat into a project (or null = flat list).
  // Organizational only — soul/history/memory travel with the chat as-is.
  const handleMoveChatToProject = useCallback(
    async (chatId: string, projectId: string | null) => {
      await setChatProject(chatId, projectId).catch(() => {});
      if (chatId === activeSessionId) setActiveProjectId(projectId);
      refreshSessions();
    },
    [activeSessionId, refreshSessions]
  );

  const handleDeleteProject = useCallback(
    async (project: ProjectInfo) => {
      if (!confirm(t("projectDeleteConfirm"))) return;
      await deleteProject(project.id).catch(() => {});
      // Chats survive project deletion (project_id nulls out) — if one is
      // open, just clear its project context.
      if (activeProjectId === project.id) setActiveProjectId(null);
      refreshSessions();
    },
    [activeProjectId, refreshSessions]
  );

  if (!configReady || !currentUser) {
    return <div className="h-dvh bg-[var(--bg-primary)]" />;
  }

  const hasGroup = !!currentUser.group;

  return (
    <div className="flex flex-col h-dvh max-h-dvh overflow-hidden">
      <Header
        logoUrl={logoUrl}
        onToggleSidebar={() => setSidebarOpen(true)}
        onNewChat={hasGroup ? handleNewChat : undefined}
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
        onTogglePin={handleTogglePin}
        onExportSession={handleExportSession}
        projects={projects}
        onNewProject={() => setProjectModal({ open: true, project: null })}
        onEditProject={(p) => setProjectModal({ open: true, project: p })}
        onShareProject={setShareProject}
        onDeleteProject={handleDeleteProject}
        onNewChatInProject={handleNewChatInProject}
        onMoveChatToProject={handleMoveChatToProject}
        logoUrl={logoUrl}
        currentUser={currentUser}
        onSignOut={handleSignOut}
      />

      {hasGroup ? (
        <>
          <main className="flex-1 overflow-hidden relative">
            <MessageList
              // Remount per session so switching chats starts at the top
              // with a fresh scroll position instead of inheriting the
              // previous chat's offset.
              key={activeSessionId ?? "new"}
              messages={messages}
              onSourceClick={setSelectedSource}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
              starterPrompts={starterPrompts}
              onStarterClick={handleSend}
              isLoading={isLoading}
              onRegenerate={handleRegenerate}
              onEditResend={handleEditResend}
              onFeedback={handleFeedback}
              currentUserId={currentUser.id}
              assistants={assistants}
              activeAssistantId={activeAssistantId}
              onSelectAssistant={handleSelectAssistant}
              onManageSouls={() => setSoulsOpen(true)}
              ttsEnabled={voice.tts}
            />
          </main>

          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isLoading={isLoading}
            mode={mode}
            defaultMode={defaultMode}
            onModeChange={handleModeChange}
            onSettingsClick={() => setShowSettings(!showSettings)}
            collectionName={
              settings.collectionId
                ? collections.find((c) => c.id === settings.collectionId)?.name ?? null
                : null
            }
            assistantName={
              activeAssistantId
                ? assistants.find((a) => a.id === activeAssistantId)?.name ?? null
                : null
            }
            sttEnabled={voice.stt}
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

      <SoulsModal
        open={soulsOpen}
        onClose={() => setSoulsOpen(false)}
        assistants={assistants}
        onChanged={refreshAssistants}
      />

      <ProjectModal
        open={projectModal.open}
        onClose={() => setProjectModal({ open: false, project: null })}
        project={projectModal.project}
        assistants={assistants}
        collections={collections}
        onSaved={refreshSessions}
      />

      <ProjectShareModal
        open={!!shareProject}
        onClose={() => setShareProject(null)}
        project={shareProject}
        onSaved={refreshSessions}
      />
    </div>
  );
}
