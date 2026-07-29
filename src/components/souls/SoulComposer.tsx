"use client";

import { useRef, useState } from "react";
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
  const [tab, setTab] = useState<SourceTab>("write");
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
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef("");

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
        onDone: () => {
          draftRef.current = cleanDraft(draftRef.current);
          setDraft(draftRef.current);
          setGenerating(false);
          setStatusLine("");
          setRefinement("");
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
          { key: "write", label: t("soulTabWrite") },
          { key: "url", label: t("soulTabUrl") },
          { key: "describe", label: t("soulTabDescribe") },
        ]}
      />

      <ErrorBanner message={error} />

      {tab === "write" && (
        <div className="space-y-3">
          <Textarea
            label={t("soulContentLabel")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder={t("soulContentPlaceholder")}
            style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label
              className="inline-flex items-center px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium cursor-pointer transition-all active:scale-[0.98]"
              style={{ background: "var(--muted)", color: "var(--fg1)" }}
            >
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
            <Button
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

          {(generating || draft) && (
            <div className="space-y-2">
              {generating && (
                <div
                  className="flex items-center gap-2 text-[11.5px] px-1"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--fg2)" }}
                >
                  <svg
                    className="w-3 h-3 animate-spin flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    style={{ color: "var(--accent)" }}
                  >
                    <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <span className="truncate">
                    {statusLine || t("soulBuilderResearching")}
                  </span>
                </div>
              )}
              <div
                className="rounded-[var(--radius)] border px-3 py-2.5 text-[12px] whitespace-pre-wrap max-h-[280px] overflow-y-auto"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--input)",
                  color: "var(--fg1)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {draft || "…"}
              </div>
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
            <div className="space-y-3">
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
