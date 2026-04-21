"use client";

import { useEffect, useRef } from "react";
import { ChatMessage, Source } from "@/types";
import { t } from "@/lib/i18n";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: ChatMessage[];
  onSourceClick: (source: Source) => void;
}

export default function MessageList({ messages, onSourceClick }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "var(--accent)" }}
        >
          <svg
            className="w-7 h-7 text-black"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">{t("emptyTitle")}</h2>
        <p className="text-[var(--text-secondary)] text-sm max-w-md">
          {t("emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="max-w-3xl mx-auto space-y-4 pb-12">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onSourceClick={onSourceClick}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
