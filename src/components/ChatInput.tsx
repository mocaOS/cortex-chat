"use client";

import { useState, useRef } from "react";
import { Mode } from "@/types";
import { t } from "@/lib/i18n";

interface Props {
  onSend: (message: string) => void;
  onStop: () => void;
  isLoading: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onSettingsClick: () => void;
  collectionName: string | null;
}

export default function ChatInput({
  onSend,
  onStop,
  isLoading,
  mode,
  onModeChange,
  onSettingsClick,
  collectionName,
}: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
      {/* Mode toggle - floating above, left-aligned with input */}
      <div className="max-w-3xl mx-auto">
        <div className="absolute -top-6">
          <div className="flex items-center bg-[var(--bg-secondary)] rounded-lg p-0.5 border border-[var(--border)] shadow-lg">
            <button
              onClick={() => onModeChange("deep-research")}
              className={`text-xs px-3 py-1 rounded-md transition-all ${
                mode === "deep-research"
                  ? "text-black font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
              style={
                mode === "deep-research"
                  ? { background: "var(--accent)" }
                  : undefined
              }
            >
              {t("deepResearch")}
            </button>
            <button
              onClick={() => onModeChange("chat")}
              className={`text-xs px-3 py-1 rounded-md transition-all ${
                mode === "chat"
                  ? "text-black font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
              style={
                mode === "chat" ? { background: "var(--accent)" } : undefined
              }
            >
              {t("chat")}
            </button>
          </div>
        </div>
      </div>

      {/* Single row: input (with send inside) + cog */}
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        <div className="flex-1 flex items-center bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border)] pl-3 pr-1.5 h-10 focus-within:border-[var(--accent)] transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "deep-research"
                ? t("deepResearchPlaceholder")
                : t("askAnything")
            }
            className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] mr-2"
          />
          {isLoading ? (
            <button
              onClick={onStop}
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              title="Stop"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30"
              style={{
                background: input.trim() ? "var(--accent)" : "var(--border)",
                color: input.trim() ? "#000" : "var(--text-secondary)",
              }}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18"
                />
              </svg>
            </button>
          )}
        </div>

        <button
          onClick={onSettingsClick}
          className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t("settings")}
        >
          <svg
            className="w-[18px] h-[18px]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>

      {/* Scope indicator */}
      <div className="max-w-3xl mx-auto mt-1.5">
        <p className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          {collectionName
            ? `${t("searchingInCollection")} ${collectionName}`
            : t("searchingAllCollections")}
        </p>
      </div>
    </div>
  );
}
