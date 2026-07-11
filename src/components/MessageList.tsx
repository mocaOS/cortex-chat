"use client";

import { ChatMessage, Source } from "@/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: ChatMessage[];
  onSourceClick: (source: Source) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export default function MessageList({
  messages,
  onSourceClick,
  emptyTitle,
  emptyDescription,
}: Props) {
  useLocale();

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
          {emptyDescription || t("emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-4 pb-8">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onSourceClick={onSourceClick}
          />
        ))}
      </div>
    </div>
  );
}
