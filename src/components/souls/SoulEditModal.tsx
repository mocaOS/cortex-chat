"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/admin/Modal";
import { Button, ErrorBanner, Input, Textarea } from "@/components/admin/ui";
import {
  cleanSoulDraft,
  fetchSoul,
  generateSoulStream,
  updateAssistantContent,
} from "@/lib/assistants-client";
import { rateLimitMessage } from "@/lib/rate-limit-message";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface Props {
  open: boolean;
  onClose: () => void;
  // Personality to edit; null while closed.
  assistantId: string | null;
  // Admin surface edits any tier via the admin endpoints; the user surface
  // edits own personal personalities only.
  admin?: boolean;
  onSaved: () => void;
}

/**
 * Edit a personality after creation: hand-edit the SOUL.md directly, or
 * describe a change and let the builder's revision pass rewrite the file
 * (streams into the same textarea, still hand-editable afterwards).
 * Frontmatter (name, description, starters, collection) re-derives on save.
 */
export default function SoulEditModal({
  open,
  onClose,
  assistantId,
  admin = false,
  onSaved,
}: Props) {
  useLocale();
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStartersHelp, setShowStartersHelp] = useState(false);

  // Revision (regenerate-with-instructions) state.
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef("");
  // The file as it was before the revision started — restored on stop/error
  // so a broken run never eats a working SOUL.md.
  const snapshotRef = useRef("");
  // Original description, passed to the revision prompt as context.
  const briefRef = useRef("");

  useEffect(() => {
    if (!open || !assistantId) return;
    setLoading(true);
    setError(null);
    setContent("");
    setInstructions("");
    fetchSoul(assistantId, admin)
      .then((a) => {
        setContent(a.soul);
        setName(a.name);
        briefRef.current = a.description || a.name;
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("failedToLoad"))
      )
      .finally(() => setLoading(false));
  }, [open, assistantId, admin]);

  // Closing the modal mid-revision aborts the stream.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setGenerating(false);
      setStatusLine("");
    }
  }, [open]);

  function endRun(nextContent: string) {
    abortRef.current = null;
    setContent(nextContent);
    setGenerating(false);
    setStatusLine("");
  }

  function runRevision() {
    if (generating || !instructions.trim() || !content.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    snapshotRef.current = content;
    streamRef.current = "";
    setGenerating(true);
    setError(null);
    setStatusLine(t("soulBuilderConnecting"));
    setContent("");
    generateSoulStream(
      {
        // The revision prompt treats this as context only — the requested
        // changes win on conflict. Never empty: zod requires min(1).
        prompt: briefRef.current || instructions.trim(),
        previousDraft: snapshotRef.current,
        refinement: instructions.trim(),
      },
      {
        onContent: (token) => {
          streamRef.current += token;
          setContent(streamRef.current);
        },
        onStatus: (message) => setStatusLine(message),
        onDone: () => {
          const revised = cleanSoulDraft(streamRef.current);
          endRun(revised || snapshotRef.current);
          if (revised) setInstructions("");
        },
        onError: (e) => {
          setError(e);
          endRun(snapshotRef.current);
        },
        onRateLimited: (secs) => {
          setError(rateLimitMessage(secs));
          endRun(snapshotRef.current);
        },
      },
      controller.signal
    );
  }

  function stopRevision() {
    abortRef.current?.abort();
    // A partial rewrite is worthless for a persona file — restore the
    // pre-revision content instead of keeping a truncated draft.
    endRun(snapshotRef.current);
  }

  async function save() {
    if (!assistantId || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateAssistantContent(assistantId, content, admin);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t("soulEditTitle")}${name ? `: ${name}` : ""}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={loading || saving || generating || !content.trim()}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner message={error} />
        {loading ? (
          <p className="text-[13px]" style={{ color: "var(--fg2)" }}>
            {t("loading")}
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: "var(--fg2)" }}
                >
                  {t("soulContentLabel")}
                </span>
                {/* Where do the suggested-question cards come from? Same
                    hover-popover pattern as the analytics variables hint. */}
                <div className="relative">
                  <button
                    type="button"
                    aria-label={t("soulStartersHelpTitle")}
                    onMouseEnter={() => setShowStartersHelp(true)}
                    onMouseLeave={() => setShowStartersHelp(false)}
                    onFocus={() => setShowStartersHelp(true)}
                    onBlur={() => setShowStartersHelp(false)}
                    className="inline-flex items-center justify-center rounded-full transition-colors"
                    style={{ color: "var(--fg2)" }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                  </button>
                  {showStartersHelp && (
                    <div
                      role="tooltip"
                      className="absolute z-10 top-0 left-0 sm:left-5 sm:top-0 w-[300px] max-w-[calc(100vw-4rem)] rounded-[var(--radius-sm)] border p-3 shadow-lg"
                      style={{
                        background: "var(--card)",
                        borderColor: "var(--border)",
                      }}
                    >
                      <div
                        className="text-[10.5px] font-medium uppercase tracking-[0.08em] mb-2"
                        style={{ color: "var(--fg2)" }}
                      >
                        {t("soulStartersHelpTitle")}
                      </div>
                      <p
                        className="text-[11.5px] leading-relaxed mb-2"
                        style={{ color: "var(--fg2)" }}
                      >
                        {t("soulStartersHelp")}
                      </p>
                      <pre
                        className="text-[11px] rounded-[var(--radius-sm)] border px-2 py-1.5 whitespace-pre-wrap"
                        style={{
                          fontFamily: "var(--font-mono)",
                          background: "var(--bg)",
                          borderColor: "var(--border)",
                          color: "var(--fg1)",
                        }}
                      >
                        {t("soulStartersHelpExample")}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                maxLength={64_000}
                disabled={generating}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  fieldSizing: "content",
                  minHeight: "240px",
                } as React.CSSProperties}
              />
            </div>
            <p className="text-[11.5px]" style={{ color: "var(--fg2)" }}>
              {t("soulEditHint")}
            </p>

            {/* Revision loop — same builder pass as the Generate tab's refine:
                describe the change, the model rewrites the file into the
                textarea above, hand-edits stay possible before saving. */}
            <div
              className="pt-3 border-t space-y-3"
              style={{ borderColor: "var(--border)" }}
            >
              <Input
                label={t("soulRefineLabel")}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={t("soulRefinePlaceholder")}
                disabled={generating}
              />
              <div className="flex items-center justify-between gap-3">
                <span
                  className="text-[11.5px] inline-flex items-center gap-2 min-w-0"
                  style={{ color: "var(--fg2)" }}
                >
                  {generating && (
                    <>
                      <svg
                        className="w-3.5 h-3.5 animate-spin flex-shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                      <span className="truncate">{statusLine}</span>
                    </>
                  )}
                </span>
                {generating ? (
                  <Button variant="secondary" onClick={stopRevision}>
                    {t("stop")}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={runRevision}
                    disabled={!instructions.trim() || !content.trim() || saving}
                  >
                    {t("soulRegenerate")}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
