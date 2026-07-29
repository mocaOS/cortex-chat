"use client";

import { AssistantSummary, ChatMessage, Source } from "@/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: ChatMessage[];
  onSourceClick: (source: Source) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  // Admin-curated suggested questions rendered as cards on the empty state.
  starterPrompts?: string[];
  onStarterClick?: (question: string) => void;
  isLoading?: boolean;
  onRegenerate?: () => void;
  onEditResend?: (messageId: string, newContent: string) => void;
  onFeedback?: (messageId: string, rating: "up" | "down") => void;
  // Souls: picker on the empty state. null = plain Cortex.
  assistants?: AssistantSummary[];
  activeAssistantId?: string | null;
  onSelectAssistant?: (id: string | null) => void;
  onManageSouls?: () => void;
  // Server-side TTS configured — read-aloud button on assistant messages.
  ttsEnabled?: boolean;
  // Ownership gating in multi-user project chats: edit/regenerate only on
  // own turns; author chips on teammates' messages.
  currentUserId?: string;
}

export default function MessageList({
  messages,
  onSourceClick,
  emptyTitle,
  emptyDescription,
  starterPrompts,
  onStarterClick,
  isLoading,
  onRegenerate,
  onEditResend,
  onFeedback,
  assistants,
  activeAssistantId,
  onSelectAssistant,
  onManageSouls,
  ttsEnabled,
  currentUserId,
}: Props) {
  useLocale();

  // Starters COMBINE: the active soul's own suggestions first, then the
  // admin-curated global prompts (deduped) — so global starters stay usable
  // with every assistant instead of being replaced by the soul's.
  const activeAssistant =
    (activeAssistantId && assistants?.find((a) => a.id === activeAssistantId)) ||
    null;
  const effectiveStarters = [
    ...new Set([...(activeAssistant?.starters ?? []), ...(starterPrompts ?? [])]),
  ].slice(0, 6);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        {/* Cortex symbol mark, tinted to the accent via a mask so the white SVG
            picks up the configurable primary color. */}
        <div
          className="h-14 w-14 mb-4"
          role="img"
          aria-label="Cortex"
          style={{
            backgroundColor: "var(--accent)",
            WebkitMaskImage: "url(/cortex_logo_white.svg)",
            maskImage: "url(/cortex_logo_white.svg)",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
        <h2
          className="text-[22px] font-bold mb-1.5"
          style={{ color: "var(--fg1)", letterSpacing: "-0.015em" }}
        >
          {emptyTitle || t("emptyTitle")}
        </h2>
        <p className="text-[13px] max-w-md" style={{ color: "var(--fg2)" }}>
          {activeAssistant?.description || emptyDescription || t("emptyDescription")}
        </p>

        {/* Soul picker — "Cortex" default + every soul the user can use */}
        {onSelectAssistant && (assistants?.length || onManageSouls) ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-5 max-w-xl">
            <SoulChip
              label={t("soulDefaultCortex")}
              active={!activeAssistantId}
              onClick={() => onSelectAssistant(null)}
            />
            {assistants?.map((a) => (
              <SoulChip
                key={a.id}
                label={a.name}
                title={a.description || undefined}
                active={a.id === activeAssistantId}
                onClick={() => onSelectAssistant(a.id)}
              />
            ))}
            {onManageSouls && (
              <button
                onClick={onManageSouls}
                className="w-7 h-7 rounded-full border flex items-center justify-center transition-colors cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--fg2)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--fg1)";
                  e.currentTarget.style.background = "var(--muted)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--fg2)";
                  e.currentTarget.style.background = "transparent";
                }}
                title={t("soulsManage")}
                aria-label={t("soulsManage")}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            )}
          </div>
        ) : null}

        {/* Starter prompt cards — one click submits the question */}
        {effectiveStarters.length > 0 && onStarterClick && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6 w-full max-w-xl">
            {effectiveStarters.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onStarterClick(prompt)}
                className="text-left text-[12.5px] leading-snug rounded-[var(--radius)] border px-3.5 py-3 transition-colors cursor-pointer"
                style={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  color: "var(--fg1)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--ring)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const lastIdx = messages.length - 1;
  // A message without authorId predates multi-user chats (or is a personal
  // chat) — treat it as the viewer's own.
  const isOwn = (m: ChatMessage) => !m.authorId || m.authorId === currentUserId;
  // Regenerate rewrites the last exchange — only offered when that exchange
  // is the viewer's own.
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const canRegenerate = !lastUserMsg || isOwn(lastUserMsg);

  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-4 pb-8">
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onSourceClick={onSourceClick}
            // Regenerate is only offered on the final answer of the thread.
            onRegenerate={
              i === lastIdx && msg.role === "assistant" && !isLoading && canRegenerate
                ? onRegenerate
                : undefined
            }
            onEditResend={!isLoading && isOwn(msg) ? onEditResend : undefined}
            onFeedback={onFeedback}
            ttsEnabled={ttsEnabled}
            authorLabel={
              msg.role === "user" && msg.authorName && !isOwn(msg)
                ? msg.authorName
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

// Pill-shaped soul selector chip. Accent marks the active persona (a "live"
// state per the design system).
function SoulChip({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors cursor-pointer max-w-[180px] truncate"
      style={
        active
          ? {
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "var(--accent-fg)",
            }
          : {
              background: "var(--card)",
              borderColor: "var(--border)",
              color: "var(--fg1)",
            }
      }
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.borderColor = "var(--ring)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {label}
    </button>
  );
}
