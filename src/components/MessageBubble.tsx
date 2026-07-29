"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, Source } from "@/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import { fetchSpeech, stripForSpeech } from "@/lib/voice-client";
import ThinkingIndicator from "./ThinkingIndicator";

interface Props {
  message: ChatMessage;
  onSourceClick: (source: Source) => void;
  // Present only on the last assistant message while idle.
  onRegenerate?: () => void;
  // Present on user messages while idle.
  onEditResend?: (messageId: string, newContent: string) => void;
  onFeedback?: (messageId: string, rating: "up" | "down") => void;
  // Server-side TTS configured — shows the read-aloud button.
  ttsEnabled?: boolean;
}

// Small hover-revealed icon button used in the message action rows.
function ActionButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center transition-colors cursor-pointer"
      style={{ color: active ? "var(--accent)" : "var(--fg3)" }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = "var(--fg1)";
        e.currentTarget.style.background = "var(--muted)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = "var(--fg3)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

// Read-aloud: fetch TTS once, cache the blob URL for replays, toggle to stop.
function ReadAloudButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function toggle() {
    if (state === "playing") {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setState("idle");
      return;
    }
    if (state === "loading") return;
    try {
      if (!urlRef.current) {
        setState("loading");
        const speakable = stripForSpeech(text);
        if (!speakable) {
          setState("idle");
          return;
        }
        const blob = await fetchSpeech(speakable);
        urlRef.current = URL.createObjectURL(blob);
        const audio = new Audio(urlRef.current);
        audio.onended = () => setState("idle");
        audioRef.current = audio;
      }
      await audioRef.current!.play();
      setState("playing");
    } catch {
      setState("idle");
    }
  }

  return (
    <ActionButton
      label={state === "playing" ? t("voiceStopAudio") : t("voiceReadAloud")}
      active={state === "playing"}
      onClick={toggle}
    >
      {state === "loading" ? (
        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      ) : state === "playing" ? (
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
          <path d="M16 9a5 5 0 0 1 0 6" />
          <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
        </svg>
      )}
    </ActionButton>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      label={copied ? t("copied") : t("copy")}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </ActionButton>
  );
}

function CitationBadge({
  index,
  source,
  onClick,
}: {
  index: number;
  source: Source;
  onClick: () => void;
}) {
  return (
    <span
      className="source-citation"
      title={source.metadata.filename}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {index}
    </span>
  );
}

// Marker that survives markdown parsing (not a link, not a comment)
const CITE_PREFIX = "\u200Bcite:";
const CITE_SPLIT = /(\u200Bcite:\d+\u200B)/g;

// One bracket group holding one or more citations: [src_3], [src_3, src_5],
// [src_3; src_5], [src_3 and src_5], [src_3 & src_5]. The model also folds prose
// into the bracket \u2014 [Research Summary, src_6, src_7] or [src_6, Research
// Summary] \u2014 so match ANY bracket that contains at least one src_N (but not a
// markdown link `[...](url)`) and expand every src_N inside it; the extraction
// below (`/src_(\d+)/gi`) keeps only the src_N tokens and drops the prose.
const SRC_GROUP_REGEX = /\[[^\]]*?src_\d+[^\]]*\](?!\()/gi;

export default function MessageBubble({
  message,
  onSourceClick,
  onRegenerate,
  onEditResend,
  onFeedback,
  ttsEnabled,
}: Props) {
  useLocale();
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const isUser = message.role === "user";

  // Auto-expand thinking while streaming, auto-collapse when done
  const thinkingCount = message.thinking?.length ?? 0;
  const isStreaming = message.isStreaming ?? false;
  useEffect(() => {
    if (isStreaming && thinkingCount > 0 && !userCollapsed) {
      setThinkingExpanded(true);
    }
    if (!isStreaming) {
      setThinkingExpanded(false);
      setUserCollapsed(false);
    }
  }, [isStreaming, thinkingCount, userCollapsed]);

  // Auto-scroll thinking steps to bottom
  useEffect(() => {
    if (thinkingScrollRef.current && isStreaming) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
    }
  }, [thinkingCount, isStreaming]);

  // Replace [src_N] with zero-width-space-wrapped markers that survive markdown
  const processedContent = useMemo(() => {
    if (!message.content) return "";
    // The backend can stream citation markers without ever emitting a matching
    // sources frame. With nothing to link to, strip the orphaned [src_N] (and
    // any space in front of it) so it never renders as literal "[src_1]" text.
    if (!message.sources?.length) {
      return message.content.replace(
        new RegExp(`\\s?${SRC_GROUP_REGEX.source}`, "gi"),
        ""
      );
    }
    return message.content.replace(SRC_GROUP_REGEX, (group) =>
      (group.match(/src_(\d+)/gi) ?? [])
        .map((token) => `${CITE_PREFIX}${token.slice(4)}\u200B`)
        .join("")
    );
  }, [message.content, message.sources]);

  if (isUser) {
    if (editing) {
      const submitEdit = () => {
        const next = draft.trim();
        setEditing(false);
        if (next && next !== message.content) {
          onEditResend?.(message.id, next);
        }
      };
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] md:max-w-[70%] w-full space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
              rows={Math.min(6, Math.max(2, draft.split("\n").length))}
              className="w-full rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-[1.55] outline-none border resize-none"
              style={{
                background: "var(--card)",
                borderColor: "var(--ring)",
                color: "var(--fg1)",
              }}
            />
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => setEditing(false)}
                className="text-[12px] px-3 py-1.5 rounded-[var(--radius)] transition-colors cursor-pointer"
                style={{ background: "var(--muted)", color: "var(--fg1)" }}
              >
                {t("cancel")}
              </button>
              <button
                onClick={submitEdit}
                disabled={!draft.trim()}
                className="text-[12px] px-3 py-1.5 rounded-[var(--radius)] font-medium transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                {t("saveAndResend")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-end">
        <div className="group max-w-[85%] md:max-w-[70%] flex flex-col items-end">
          <div
            className="rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap"
            style={{
              background: "var(--primary)",
              color: "var(--primary-fg)",
            }}
          >
            {message.content}
          </div>
          {/* Hover action row — copy / edit-and-resend */}
          <div className="flex gap-0.5 mt-1 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
            <CopyButton text={message.content} />
            {onEditResend && (
              <ActionButton
                label={t("editMessage")}
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              </ActionButton>
            )}
          </div>
        </div>
      </div>
    );
  }

  const hasThinking = message.thinking && message.thinking.length > 0;
  const hasSources = message.sources && message.sources.length > 0;

  const cite = (children: React.ReactNode) =>
    injectCitations(children, message.sources || [], onSourceClick);

  return (
    <div className="flex justify-start">
      <div className="group max-w-[85%] md:max-w-[80%] space-y-2 w-full">
        {/* Thinking steps card */}
        {hasThinking && (
          <div
            className="rounded-[var(--radius-lg)] overflow-hidden text-xs border"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            <button
              onClick={() => {
                setThinkingExpanded(!thinkingExpanded);
                setUserCollapsed(thinkingExpanded);
              }}
              className="flex items-center gap-2 px-3.5 py-2.5 w-full text-left text-[var(--fg2)] hover:text-[var(--fg1)] transition-colors"
            >
              {/* Sparkle icon — accent because this represents live AI work */}
              <svg
                className="w-3.5 h-3.5 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--accent)" }}
              >
                <path d="M12 3l1.9 5.8L20 10l-5.8 1.9L12 18l-1.9-5.8L4 10l6.1-1.2L12 3z" />
              </svg>
              <span
                className="font-medium flex-1 uppercase tracking-[0.08em] text-[10.5px]"
                style={{ color: "var(--fg2)" }}
              >
                {isStreaming
                  ? `${t("thinking")}…`
                  : `${t("thinking")} · ${message.thinking!.length} ${t("steps")}`}
              </span>
              {isStreaming ? (
                <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg
                  className={`w-3 h-3 transition-transform ${thinkingExpanded ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
            {(isStreaming && !userCollapsed || !isStreaming && thinkingExpanded) && (
              <div
                ref={thinkingScrollRef}
                className="max-h-[200px] overflow-y-auto px-3.5 pb-2.5 thinking-steps-fade"
              >
                {message.thinking!.map((step, i) => {
                  // Skill failures arrive on the same thinking stream (the
                  // backend emits "API call failed: …" / "Failed to activate
                  // skill …"). Surface them distinctly instead of as plain text.
                  const failed = /API call failed|Failed to activate/i.test(step);
                  return (
                    <div key={i} className="flex gap-3 py-0.5 leading-relaxed">
                      <span
                        className="select-none w-4 text-right flex-shrink-0 tabular-nums"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: failed ? "var(--destructive)" : "var(--fg3)",
                        }}
                      >
                        {failed ? "!" : i + 1}
                      </span>
                      <span
                        style={{ color: failed ? "var(--destructive)" : "var(--fg2)" }}
                      >
                        {step}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Sub-questions */}
        {message.subQuestions && message.subQuestions.length > 0 && (
          <div
            className="text-xs text-[var(--fg2)] rounded-[var(--radius)] px-3.5 py-2.5 border"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            <span
              className="font-medium uppercase tracking-[0.08em] text-[10.5px]"
              style={{ color: "var(--fg2)" }}
            >
              {t("researchAreas")}
            </span>
            <ul className="ml-3 mt-1.5 space-y-0.5 list-disc text-[var(--fg1)]">
              {message.subQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Retrieval progress */}
        {message.isStreaming && message.retrieval && message.retrieval.length > 0 && (
          <div
            className="text-xs text-[var(--fg2)] flex items-center gap-2 px-1"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <svg className="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{message.retrieval[message.retrieval.length - 1]}</span>
          </div>
        )}

        {/* Main AI answer card */}
        <div
          className={`rounded-[var(--radius-lg)] border px-4 py-3.5 text-[14.5px] leading-[1.65] ${
            !message.content && message.isStreaming ? "w-fit" : ""
          }`}
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            color: "var(--fg1)",
          }}
        >
          {message.content ? (
            <div className="markdown-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children, ...props }) => <p {...props}>{cite(children)}</p>,
                  li: ({ children, ...props }) => <li {...props}>{cite(children)}</li>,
                  strong: ({ children, ...props }) => <strong {...props}>{cite(children)}</strong>,
                  em: ({ children, ...props }) => <em {...props}>{cite(children)}</em>,
                  h1: ({ children, ...props }) => <h1 {...props}>{cite(children)}</h1>,
                  h2: ({ children, ...props }) => <h2 {...props}>{cite(children)}</h2>,
                  h3: ({ children, ...props }) => <h3 {...props}>{cite(children)}</h3>,
                  h4: ({ children, ...props }) => <h4 {...props}>{cite(children)}</h4>,
                  td: ({ children, ...props }) => <td {...props}>{cite(children)}</td>,
                  th: ({ children, ...props }) => <th {...props}>{cite(children)}</th>,
                }}
              >
                {processedContent}
              </ReactMarkdown>
            </div>
          ) : message.isStreaming ? (
            <ThinkingIndicator message={message} />
          ) : null}

          {/* Sources strip inside the answer card — MOCA pattern */}
          {hasSources && !message.isStreaming && (
            <div
              className="flex flex-wrap gap-1.5 mt-3.5 pt-3 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              {message.sources!.map((source, i) => (
                <button
                  key={source.chunk_id}
                  onClick={() => onSourceClick(source)}
                  className="group inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1 rounded-[6px] transition-colors"
                  style={{
                    background: "var(--muted)",
                    color: "var(--fg1)",
                  }}
                >
                  <span
                    className="text-[10px] leading-none"
                    style={{
                      color: "var(--fg3)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    [{i + 1}]
                  </span>
                  <svg
                    className="w-3.5 h-3.5 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--fg2)" }}
                  >
                    <path d="M14 2H6a2 2 0 0 0 -2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M16 13H8" />
                    <path d="M16 17H8" />
                    <path d="M10 9H8" />
                  </svg>
                  <span className="truncate max-w-[160px]">
                    {source.metadata.filename}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action row — copy / regenerate / feedback. Hidden while streaming;
            revealed on hover (always visible on touch devices). */}
        {!message.isStreaming && message.content && (
          <div className="flex gap-0.5 -mt-0.5 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
            <CopyButton text={message.content} />
            {ttsEnabled && <ReadAloudButton text={message.content} />}
            {onRegenerate && (
              <ActionButton label={t("regenerate")} onClick={onRegenerate}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
              </ActionButton>
            )}
            {onFeedback && (
              <>
                <ActionButton
                  label={t("goodResponse")}
                  active={message.feedback === "up"}
                  onClick={() => {
                    if (message.feedback !== "up") onFeedback(message.id, "up");
                  }}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill={message.feedback === "up" ? "currentColor" : "none"}
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 10v12" />
                    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                  </svg>
                </ActionButton>
                <ActionButton
                  label={t("badResponse")}
                  active={message.feedback === "down"}
                  onClick={() => {
                    if (message.feedback !== "down") onFeedback(message.id, "down");
                  }}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill={message.feedback === "down" ? "currentColor" : "none"}
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 14V2" />
                    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
                  </svg>
                </ActionButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function injectCitations(
  children: React.ReactNode,
  sources: Source[],
  onSourceClick: (source: Source) => void
): React.ReactNode {
  if (!children) return children;
  if (!sources.length) return children;

  const childArray = Array.isArray(children) ? children : [children];

  return childArray.flatMap((child, i) => {
    if (typeof child !== "string") return child;

    const parts = child.split(CITE_SPLIT);
    if (parts.length === 1) return child;

    return parts.map((part, j) => {
      const match = part.match(/\u200Bcite:(\d+)\u200B/);
      if (match) {
        const idx = parseInt(match[1], 10) - 1;
        const source = sources[idx];
        if (source) {
          return (
            <CitationBadge
              key={`c-${i}-${j}`}
              index={idx + 1}
              source={source}
              onClick={() => onSourceClick(source)}
            />
          );
        }
        return null;
      }
      return part || null;
    });
  });
}
