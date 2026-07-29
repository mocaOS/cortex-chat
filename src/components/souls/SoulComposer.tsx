"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ErrorBanner, Tabs, Textarea, Input } from "@/components/admin/ui";
import { generateSoulStream } from "@/lib/assistants-client";
import { rateLimitMessage } from "@/lib/rate-limit-message";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

type SourceTab = "write" | "url" | "describe";

interface Props {
  // Resolves when the soul was saved; the composer resets itself.
  onSubmit: (input: { content?: string; url?: string }) => Promise<void>;
}

// The generated draft streams straight from a RAG answer, so it can carry
// citation markers — meaningless inside a persona file. Strip them.
function cleanDraft(raw: string): string {
  return raw
    .replace(/\s?\[[^\]]*?src_\d+[^\]]*?\](?!\()/gi, "")
    .replace(/^```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n```\s*$/, "")
    .trim();
}

export default function SoulComposer({ onSubmit }: Props) {
  useLocale();
  // Generate is the default entry point — most users describe, few paste.
  const [tab, setTab] = useState<SourceTab>("describe");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Describe (Soul Builder) state
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [refinement, setRefinement] = useState("");
  const [generating, setGenerating] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  // Agent activity log — every research step the builder takes, visible live
  // (mirrors the chat's thinking card).
  const [steps, setSteps] = useState<string[]>([]);
  const [stepsExpanded, setStepsExpanded] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef("");
  const stepsScrollRef = useRef<HTMLDivElement>(null);
  const draftScrollRef = useRef<HTMLDivElement>(null);

  // Auto-follow both the step log and the streaming draft.
  useEffect(() => {
    if (generating && stepsScrollRef.current) {
      stepsScrollRef.current.scrollTop = stepsScrollRef.current.scrollHeight;
    }
  }, [steps, generating]);
  useEffect(() => {
    if (generating && draftScrollRef.current) {
      draftScrollRef.current.scrollTop = draftScrollRef.current.scrollHeight;
    }
  }, [draft, generating]);

  async function save(input: { content?: string; url?: string }) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(input);
      setContent("");
      setUrl("");
      setDraft("");
      setPrompt("");
      setRefinement("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function runGenerate(refine: boolean) {
    if (!prompt.trim() || generating) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setError(null);
    setStatusLine(t("soulBuilderConnecting"));
    setSteps([]);
    setStepsExpanded(true);
    const previous = refine ? draftRef.current : undefined;
    draftRef.current = "";
    setDraft("");
    generateSoulStream(
      {
        prompt: prompt.trim(),
        previousDraft: previous,
        refinement: refine ? refinement.trim() : undefined,
      },
      {
        onContent: (token) => {
          draftRef.current += token;
          setDraft(draftRef.current);
        },
        onStatus: (message) => setStatusLine(message),
        onThinking: (step) => setSteps((prev) => [...prev, step]),
        onDone: () => {
          draftRef.current = cleanDraft(draftRef.current);
          setDraft(draftRef.current);
          setGenerating(false);
          setStatusLine("");
          setRefinement("");
          setStepsExpanded(false);
        },
        onError: (e) => {
          setError(e);
          setGenerating(false);
          setStatusLine("");
        },
        onRateLimited: (secs) => {
          setError(rateLimitMessage(secs));
          setGenerating(false);
          setStatusLine("");
        },
      },
      controller.signal
    );
  }

  function stopGenerate() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setStatusLine("");
    draftRef.current = cleanDraft(draftRef.current);
    setDraft(draftRef.current);
  }

  return (
    <div className="space-y-4">
      <Tabs
        active={tab}
        onChange={(k) => {
          setTab(k);
          setError(null);
        }}
        tabs={[
          { key: "describe", label: t("soulTabDescribe") },
          { key: "write", label: t("soulTabWrite") },
          { key: "url", label: t("soulTabUrl") },
        ]}
      />

      <ErrorBanner message={error} />

      {tab === "write" && (
        <div className="space-y-3">
          {/* Upload is the primary action; the textarea below is for pasting
              or hand-editing the loaded file before saving. */}
          <label
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium cursor-pointer transition-all active:scale-[0.98]"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
            {t("soulUploadFile")}
            <input
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  f.text().then(setContent);
                }
                e.target.value = "";
              }}
            />
          </label>
          <Textarea
            label={t("soulContentLabel")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder={t("soulContentPlaceholder")}
            style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
          />
          <div className="flex justify-end">
            {/* Secondary: the accent in this tab belongs to the upload CTA */}
            <Button
              variant="secondary"
              onClick={() => save({ content })}
              disabled={!content.trim() || saving}
            >
              {saving ? t("saving") : t("soulSave")}
            </Button>
          </div>
        </div>
      )}

      {tab === "url" && (
        <div className="space-y-3">
          <Input
            label={t("soulUrlLabel")}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
          <p className="text-[11.5px]" style={{ color: "var(--fg2)" }}>
            {t("soulUrlHint")}
          </p>
          <div className="flex justify-end">
            <Button onClick={() => save({ url })} disabled={!url.trim() || saving}>
              {saving ? t("saving") : t("soulImport")}
            </Button>
          </div>
        </div>
      )}

      {tab === "describe" && (
        <div className="space-y-3">
          <Textarea
            label={t("soulDescribeLabel")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder={t("soulDescribePlaceholder")}
            disabled={generating}
          />
          {!draft && !generating && (
            <div className="flex justify-end">
              <Button onClick={() => runGenerate(false)} disabled={!prompt.trim()}>
                {t("soulGenerate")}
              </Button>
            </div>
          )}

          {(generating || draft || steps.length > 0) && (
            <div className="space-y-2">
              {/* Agent activity log — every step, live, like the chat's
                  thinking card. Collapses to a summary once done. */}
              {(generating || steps.length > 0) && (
                <div
                  className="rounded-[var(--radius)] overflow-hidden text-xs border"
                  style={{ background: "var(--card)", borderColor: "var(--border)" }}
                >
                  <button
                    type="button"
                    onClick={() => setStepsExpanded((v) => !v)}
                    className="flex items-center gap-2 px-3 py-2 w-full text-left transition-colors"
                    style={{ color: "var(--fg2)" }}
                  >
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
                    <span className="font-medium flex-1 uppercase tracking-[0.08em] text-[10.5px] truncate">
                      {generating
                        ? statusLine || t("soulBuilderResearching")
                        : `${t("soulBuilderLog")} · ${steps.length} ${t("steps")}`}
                    </span>
                    {generating ? (
                      <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                    ) : (
                      <svg
                        className={`w-3 h-3 flex-shrink-0 transition-transform ${stepsExpanded ? "rotate-90" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                  {stepsExpanded && steps.length > 0 && (
                    <div
                      ref={stepsScrollRef}
                      className="max-h-[180px] overflow-y-auto px-3 pb-2"
                    >
                      {steps.map((step, i) => (
                        <div key={i} className="flex gap-3 py-0.5 leading-relaxed">
                          <span
                            className="select-none w-4 text-right flex-shrink-0 tabular-nums"
                            style={{ fontFamily: "var(--font-mono)", color: "var(--fg3)" }}
                          >
                            {i + 1}
                          </span>
                          <span style={{ color: "var(--fg2)" }}>{step}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Draft — auto-follows while streaming; once done it becomes
                  an editable textarea for hand-tuning before saving. */}
              {generating ? (
                <div
                  ref={draftScrollRef}
                  className="rounded-[var(--radius)] border px-3 py-2.5 text-[12px] whitespace-pre-wrap max-h-[40vh] overflow-y-auto"
                  style={{
                    background: "var(--bg)",
                    borderColor: "var(--input)",
                    color: "var(--fg1)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {draft || "…"}
                </div>
              ) : draft ? (
                <Textarea
                  value={draft}
                  onChange={(e) => {
                    // Keep the ref in sync so refine + save use the edits.
                    draftRef.current = e.target.value;
                    setDraft(e.target.value);
                  }}
                  rows={8}
                  maxLength={64_000}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    // Auto-grow with content: the modal body stays the ONE
                    // scroll container (no textarea-in-modal double
                    // scrollbar). Browsers without field-sizing fall back to
                    // the rows height + inner scroll.
                    fieldSizing: "content",
                    minHeight: "160px",
                  } as React.CSSProperties}
                />
              ) : null}
            </div>
          )}

          {generating && (
            <div className="flex justify-end">
              <Button variant="secondary" onClick={stopGenerate}>
                {t("stop")}
              </Button>
            </div>
          )}

          {!generating && draft && (
            /* Sticky inside the modal's scroll container: the refine field
               and actions stay reachable no matter how long the draft is.
               Negative margins span the modal body's padding; solid popover
               background so scrolled draft text never shines through. */
            <div
              className="sticky bottom-0 -mx-5 -mb-4 px-5 py-3 border-t space-y-3"
              style={{ background: "var(--popover)", borderColor: "var(--border)" }}
            >
              <Input
                label={t("soulRefineLabel")}
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
                placeholder={t("soulRefinePlaceholder")}
              />
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  onClick={() => runGenerate(!!refinement.trim())}
                >
                  {refinement.trim() ? t("soulRefine") : t("soulRegenerate")}
                </Button>
                <Button onClick={() => save({ content: draft })} disabled={saving}>
                  {saving ? t("saving") : t("soulUse")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
