"use client";

import { useState, useRef } from "react";
import { Mode } from "@/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import { transcribeAudio } from "@/lib/voice-client";

interface Props {
  onSend: (message: string) => void;
  onStop: () => void;
  isLoading: boolean;
  mode: Mode;
  // Admin-configured default — rendered as the first toggle option.
  defaultMode: Mode;
  onModeChange: (mode: Mode) => void;
  onSettingsClick: () => void;
  collectionName: string | null;
  // Active soul name — shown as a chip so an ongoing chat reveals its persona.
  assistantName?: string | null;
  // Server-side STT configured — shows the dictation mic.
  sttEnabled?: boolean;
}

export default function ChatInput({
  onSend,
  onStop,
  isLoading,
  mode,
  defaultMode,
  onModeChange,
  onSettingsClick,
  collectionName,
  assistantName,
  sttEnabled,
}: Props) {
  useLocale();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Dictation: MediaRecorder → /api/voice/transcribe → append to the input.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const voiceErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showVoiceError(message: string) {
    setVoiceError(message);
    if (voiceErrorTimerRef.current) clearTimeout(voiceErrorTimerRef.current);
    voiceErrorTimerRef.current = setTimeout(() => setVoiceError(null), 6000);
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (transcribing) return;
    // The mic permission popup is a browser privilege reserved for SECURE
    // origins (https or localhost). On http://<LAN-IP> the browser refuses
    // without ever prompting — Chrome hides the API entirely, Firefox
    // exposes it but instantly rejects with NotAllowedError (which reads
    // like a user denial). isSecureContext is the reliable signal for both.
    if (!window.isSecureContext) {
      showVoiceError(t("voiceInsecureContext"));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showVoiceError(t("voiceInsecureContext"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        if (blob.size < 200) return; // tap without speech — nothing to send
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          if (text) setInput((prev) => (prev ? `${prev} ${text}` : text));
        } catch {
          showVoiceError(t("voiceTranscribeFailed"));
        }
        setTranscribing(false);
        inputRef.current?.focus();
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      // NotAllowedError with NO permission popup = the browser has the mic
      // persistently blocked for this origin (or a global policy) — a
      // re-prompt can't be forced from code, the user must unblock it in
      // the site settings. Say so instead of a generic "denied".
      // Keep the real reason visible — the UI message is a best guess, the
      // browser's error name/message is the ground truth for diagnosis.
      console.warn("[voice] getUserMedia failed:", err);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        showVoiceError(t("voiceNoMic"));
      } else if (name === "NotAllowedError" || name === "SecurityError") {
        showVoiceError(t("voiceMicBlocked"));
      } else {
        showVoiceError(t("voiceMicDenied"));
      }
    }
  }

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

  const canSend = !!input.trim() && !isLoading;

  const modeOrder: Mode[] =
    defaultMode === "deep-research"
      ? ["deep-research", "chat"]
      : ["chat", "deep-research"];

  return (
    <div className="px-4 pt-3 pb-5">
      <div className="max-w-3xl mx-auto space-y-2">
        {/* Mode toggle */}
        <div className="flex items-center">
          <div
            className="inline-flex items-center rounded-full p-0.5 border"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            {modeOrder.map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`text-xs px-3 py-1 rounded-full transition-all ${
                  mode === m
                    ? "font-medium"
                    : "text-[var(--fg2)] hover:text-[var(--fg1)]"
                }`}
                style={
                  mode === m
                    ? { background: "var(--accent)", color: "var(--accent-fg)" }
                    : undefined
                }
              >
                {m === "chat" ? t("chat") : t("deepResearch")}
              </button>
            ))}
          </div>
        </div>

        {/* Glass composer row */}
        <div className="flex items-center gap-2">
          <div
            className="flex-1 flex items-center gap-1 rounded-[14px] pl-3 pr-1.5 h-11 border transition-colors focus-within:border-[var(--ring)]"
            style={{
              background: "oklch(0.15 0 0 / 0.75)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              borderColor: "var(--border)",
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <svg
              className="w-4 h-4 text-[var(--fg2)] flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1 -2 2h-14l-4 4v-16a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2z" />
            </svg>

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
              className="flex-1 bg-transparent outline-none text-sm text-[var(--fg1)] placeholder:text-[var(--fg3)] px-2"
            />

            {assistantName && (
              <span
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-[var(--fg2)] whitespace-nowrap"
                style={{ background: "var(--muted)" }}
                title={`${t("soulActive")}: ${assistantName}`}
              >
                <svg
                  className="w-3 h-3 flex-shrink-0"
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
                <span className="truncate max-w-[110px]">{assistantName}</span>
              </span>
            )}

            <span
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-[var(--fg2)] whitespace-nowrap"
              style={{ background: "var(--muted)" }}
              title={
                collectionName
                  ? `${t("searchingInCollection")} ${collectionName}`
                  : t("searchingAllCollections")
              }
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <span className="truncate max-w-[120px]">
                {collectionName || t("allCollections")}
              </span>
            </span>

            {sttEnabled && !isLoading && (
              <button
                onClick={toggleRecording}
                disabled={transcribing}
                className={`flex-shrink-0 w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center transition-colors ${recording ? "animate-pulse" : ""}`}
                style={
                  recording
                    ? {
                        background:
                          "color-mix(in oklch, var(--destructive) 18%, transparent)",
                        color: "var(--destructive)",
                      }
                    : { color: "var(--fg2)" }
                }
                onMouseEnter={(e) => {
                  if (!recording) e.currentTarget.style.color = "var(--fg1)";
                }}
                onMouseLeave={(e) => {
                  if (!recording) e.currentTarget.style.color = "var(--fg2)";
                }}
                title={recording ? t("voiceStopRecording") : t("voiceDictate")}
                aria-label={recording ? t("voiceStopRecording") : t("voiceDictate")}
              >
                {transcribing ? (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                ) : recording ? (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <path d="M12 19v3" />
                  </svg>
                )}
              </button>
            )}

            {isLoading ? (
              <button
                onClick={onStop}
                className="flex-shrink-0 w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center transition-colors"
                style={{
                  background:
                    "color-mix(in oklch, var(--destructive) 18%, transparent)",
                  color: "var(--destructive)",
                }}
                title={t("stop")}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                className="flex-shrink-0 w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center transition-all disabled:opacity-30 active:scale-[0.96]"
                style={{
                  background: canSend ? "var(--accent)" : "var(--muted)",
                  color: canSend ? "var(--accent-fg)" : "var(--fg3)",
                  boxShadow: canSend
                    ? "0 0 20px color-mix(in oklch, var(--accent) 35%, transparent)"
                    : "none",
                }}
                aria-label={t("send")}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 2 11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            )}
          </div>

          <button
            onClick={onSettingsClick}
            className="flex-shrink-0 w-10 h-10 rounded-[var(--radius)] flex items-center justify-center text-[var(--fg2)] hover:text-[var(--fg1)] hover:bg-[var(--muted)] transition-colors"
            title={t("settings")}
          >
            <svg
              className="w-[18px] h-[18px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06 .06a2 2 0 0 1 -2.83 2.83l-.06 -.06a1.65 1.65 0 0 0 -1.82 -.33 1.65 1.65 0 0 0 -1 1.51V21a2 2 0 0 1 -4 0v-.09a1.65 1.65 0 0 0 -1 -1.51 1.65 1.65 0 0 0 -1.82 .33l-.06 .06a2 2 0 0 1 -2.83 -2.83l.06 -.06a1.65 1.65 0 0 0 .33 -1.82 1.65 1.65 0 0 0 -1.51 -1H3a2 2 0 0 1 0 -4h.09a1.65 1.65 0 0 0 1.51 -1 1.65 1.65 0 0 0 -.33 -1.82l-.06 -.06a2 2 0 0 1 2.83 -2.83l.06 .06a1.65 1.65 0 0 0 1.82 .33H9a1.65 1.65 0 0 0 1 -1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82 -.33l.06 -.06a2 2 0 0 1 2.83 2.83l-.06 .06a1.65 1.65 0 0 0 -.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0 -1.51 1z" />
            </svg>
          </button>
        </div>

        {/* Voice error (transient) */}
        {voiceError && (
          <p
            className="text-[11.5px] px-1"
            style={{ color: "var(--destructive)" }}
          >
            {voiceError}
          </p>
        )}

        {/* Scope caption (mobile) + mono caption */}
        <p
          className="text-[11px] flex items-center gap-1.5 px-1"
          style={{ fontFamily: "var(--font-mono)", color: "oklch(0.42 0 0)" }}
        >
          <svg
            className="w-3 h-3 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          {collectionName
            ? `${t("searchingInCollection")} ${collectionName}`
            : t("searchingAllCollections")}
        </p>
      </div>
    </div>
  );
}
