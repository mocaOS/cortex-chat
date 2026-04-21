"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, Source } from "@/types";
import { t } from "@/lib/i18n";

interface Props {
  message: ChatMessage;
  onSourceClick: (source: Source) => void;
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
const CITE_REGEX = /\u200Bcite:(\d+)\u200B/g;
const CITE_SPLIT = /(\u200Bcite:\d+\u200B)/g;

export default function MessageBubble({ message, onSourceClick }: Props) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);
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
    if (!message.sources?.length) return message.content;
    return message.content.replace(
      /\[src_(\d+)\]/g,
      `${CITE_PREFIX}$1\u200B`
    );
  }, [message.content, message.sources]);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] md:max-w-[70%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap"
          style={{ background: "var(--accent)", color: "#000" }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  const hasThinking = message.thinking && message.thinking.length > 0;
  const hasSources = message.sources && message.sources.length > 0;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] md:max-w-[80%] space-y-2">
        {/* Thinking steps card */}
        {hasThinking && (
          <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden text-xs">
            <button
              onClick={() => {
                setThinkingExpanded(!thinkingExpanded);
                setUserCollapsed(thinkingExpanded);
              }}
              className="flex items-center gap-2 px-3.5 py-2.5 w-full text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {/* Sparkle icon */}
              <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z" />
              </svg>
              <span className="font-medium flex-1">
                {isStreaming
                  ? `${t("thinking")}...`
                  : `${t("thinking")} (${message.thinking!.length} ${t("steps")})`
                }
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
                {message.thinking!.map((step, i) => (
                  <div key={i} className="flex gap-3 py-0.5 leading-relaxed">
                    <span className="text-[var(--text-secondary)] opacity-40 select-none w-4 text-right flex-shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-[var(--text-secondary)]">{step}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sub-questions */}
        {message.subQuestions && message.subQuestions.length > 0 && (
          <div className="text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
            <span className="font-medium">{t("researchAreas")}</span>
            <ul className="ml-3 mt-1 space-y-0.5 list-disc">
              {message.subQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Retrieval progress */}
        {message.isStreaming && message.retrieval && message.retrieval.length > 0 && (
          <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2 px-1">
            <svg className="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{message.retrieval[message.retrieval.length - 1]}</span>
          </div>
        )}

        {/* Main content */}
        <div className={`rounded-2xl rounded-bl-md bg-[var(--bg-secondary)] px-4 py-3 text-sm ${!message.content && message.isStreaming ? "w-fit" : ""}`}>
          {message.content ? (
            <div className="markdown-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children, ...props }) => (
                    <p {...props}>
                      {injectCitations(children, message.sources || [], onSourceClick)}
                    </p>
                  ),
                  li: ({ children, ...props }) => (
                    <li {...props}>
                      {injectCitations(children, message.sources || [], onSourceClick)}
                    </li>
                  ),
                  strong: ({ children, ...props }) => (
                    <strong {...props}>
                      {injectCitations(children, message.sources || [], onSourceClick)}
                    </strong>
                  ),
                  em: ({ children, ...props }) => (
                    <em {...props}>
                      {injectCitations(children, message.sources || [], onSourceClick)}
                    </em>
                  ),
                }}
              >
                {processedContent}
              </ReactMarkdown>
            </div>
          ) : message.isStreaming ? (
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <div className="flex items-center gap-1">
                <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)]" />
                <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)]" />
                <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)]" />
              </div>
            </div>
          ) : null}
        </div>

        {/* Sources bar */}
        {hasSources && !message.isStreaming && (
          <div className="flex flex-wrap gap-1.5">
            {message.sources!.map((source, i) => (
              <button
                key={source.chunk_id}
                onClick={() => onSourceClick(source)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors"
              >
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-black flex-shrink-0"
                  style={{ background: "var(--accent)" }}
                >
                  {i + 1}
                </span>
                <span className="truncate max-w-[140px]">
                  {source.metadata.filename}
                </span>
              </button>
            ))}
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
