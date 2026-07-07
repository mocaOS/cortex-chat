"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Select, Textarea } from "@/components/admin/ui";
import { t } from "@/lib/i18n";
import { rateLimitMessage } from "@/lib/rate-limit-message";

interface Collection {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
}

interface DiscoveredLink {
  url: string;
  title: string;
}

type ContentFilter = "fit" | "raw" | "bm25";

interface Toast {
  kind: "success" | "error";
  text: string;
  hint?: string;
}

interface TaskState {
  percent: number;
  message: string;
}

const POLL_INTERVAL_MS = 1500;

export default function WebImportForm({
  collections,
  collectionId,
  setCollectionId,
}: {
  collections: Collection[];
  collectionId: string;
  setCollectionId: (id: string) => void;
}) {
  const [urlsText, setUrlsText] = useState("");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("fit");
  const [query, setQuery] = useState("");

  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverUrl, setDiscoverUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredLink[] | null>(null);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());

  const [importing, setImporting] = useState(false);
  const [task, setTask] = useState<TaskState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Polling lifecycle guard — cancels in-flight loops on unmount.
  const pollingRef = useRef(false);
  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  function parseUrls(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of urlsText.split("\n")) {
      const u = raw.trim();
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    }
    return out;
  }

  const urlCount = parseUrls().length;

  async function handleDiscover() {
    const url = discoverUrl.trim();
    if (!url) return;
    setDiscovering(true);
    setToast(null);
    setDiscovered(null);
    try {
      const res = await fetch("/api/me/web-import/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("webImportDiscoverFailed"));
      const links: DiscoveredLink[] = data.links ?? [];
      setDiscovered(links);
      setSelectedLinks(new Set());
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : t("webImportDiscoverFailed"),
      });
    } finally {
      setDiscovering(false);
    }
  }

  function toggleLink(url: string) {
    setSelectedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function addSelectedLinks() {
    if (selectedLinks.size === 0) return;
    const existing = new Set(parseUrls());
    const additions = [...selectedLinks].filter((u) => !existing.has(u));
    if (additions.length > 0) {
      setUrlsText((prev) => (prev.trim() ? `${prev.trim()}\n` : "") + additions.join("\n"));
    }
    setSelectedLinks(new Set());
    setDiscovered(null);
    setDiscoverOpen(false);
  }

  async function pollTask(taskId: string) {
    pollingRef.current = true;
    while (pollingRef.current) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!pollingRef.current) return;
      let data: Record<string, unknown> = {};
      try {
        const res = await fetch(`/api/proxy/api/tasks/${encodeURIComponent(taskId)}`);
        data = await res.json().catch(() => ({}));
        if (!res.ok) continue; // transient — keep polling
      } catch {
        continue;
      }

      const status = data.status as string | undefined;
      const percent = Number(data.progress_percent ?? 0);
      const message = String(data.message ?? "");
      setTask({ percent, message });

      if (status === "completed") {
        pollingRef.current = false;
        const result = (data.result ?? {}) as {
          imported?: number;
          failed?: number;
          total?: number;
        };
        const imported = result.imported ?? 0;
        const total = result.total ?? imported;
        const failed = result.failed ?? 0;
        setToast({
          kind: imported > 0 ? "success" : "error",
          text: t("webImportDone", { imported, total }),
          hint:
            failed > 0
              ? t("webImportFailedCount", { failed })
              : t("webImportSuccessHint"),
        });
        setTask(null);
        setImporting(false);
        if (imported > 0) {
          setUrlsText("");
        }
        return;
      }
      if (status === "failed") {
        pollingRef.current = false;
        setToast({
          kind: "error",
          text: String(data.error || t("webImportTaskFailed")),
        });
        setTask(null);
        setImporting(false);
        return;
      }
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const urls = parseUrls();
    if (urls.length === 0) return;
    setImporting(true);
    setToast(null);
    setTask({ percent: 0, message: t("webImportStarting") });

    try {
      const res = await fetch("/api/me/web-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          collection_id: collectionId || null,
          content_filter: contentFilter,
          query: contentFilter === "bm25" ? query.trim() || undefined : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        // Burst rate limit or monthly unit quota — Retry-After tells them apart.
        const retryAfter = res.headers.get("Retry-After");
        throw new Error(
          rateLimitMessage(
            retryAfter && Number.isFinite(Number(retryAfter))
              ? Number(retryAfter)
              : null
          )
        );
      }
      if (!res.ok || !data.task_id) {
        throw new Error(data.error || t("webImportFailed"));
      }
      // Hand off to the progress poller.
      pollTask(data.task_id);
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : t("webImportFailed"),
      });
      setTask(null);
      setImporting(false);
    }
  }

  return (
    <form
      onSubmit={handleImport}
      className="rounded-[var(--radius-lg)] border p-5 space-y-4"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <Select
        label={t("collection")}
        value={collectionId}
        onChange={(e) => setCollectionId(e.target.value)}
      >
        {collections.length === 0 && (
          <option value="">{t("noCollectionsAvailable")}</option>
        )}
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      <Textarea
        label={t("webImportUrls")}
        rows={5}
        value={urlsText}
        onChange={(e) => setUrlsText(e.target.value)}
        placeholder={t("webImportUrlsPlaceholder")}
        className="font-mono text-[12px]"
        disabled={importing}
      />

      {/* Discover links — same-site link harvesting */}
      <div
        className="rounded-[var(--radius)] border"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => setDiscoverOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[12px]"
          style={{ color: "var(--fg2)" }}
        >
          <span className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            {t("webImportDiscover")}
          </span>
          <svg
            className="w-3.5 h-3.5 transition-transform"
            style={{ transform: discoverOpen ? "rotate(180deg)" : "none" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {discoverOpen && (
          <div
            className="px-3 pb-3 pt-1 space-y-3 border-t"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-[12px] pt-2" style={{ color: "var(--fg3)" }}>
              {t("webImportDiscoverHint")}
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  value={discoverUrl}
                  onChange={(e) => setDiscoverUrl(e.target.value)}
                  placeholder="https://example.com/docs"
                  disabled={discovering}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleDiscover}
                disabled={discovering || !discoverUrl.trim()}
              >
                {discovering ? t("webImportDiscovering") : t("webImportDiscover")}
              </Button>
            </div>

            {discovered && discovered.length === 0 && (
              <p className="text-[12px]" style={{ color: "var(--fg3)" }}>
                {t("webImportNoLinks")}
              </p>
            )}

            {discovered && discovered.length > 0 && (
              <div className="space-y-2">
                <div
                  className="max-h-52 overflow-y-auto space-y-1 rounded-[var(--radius)] border p-2"
                  style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                >
                  {discovered.map((link) => (
                    <label
                      key={link.url}
                      className="flex items-start gap-2 px-1 py-1 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLinks.has(link.url)}
                        onChange={() => toggleLink(link.url)}
                        className="mt-0.5"
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span className="min-w-0">
                        <span
                          className="block text-[12px] truncate"
                          style={{ color: "var(--fg1)" }}
                        >
                          {link.title || link.url}
                        </span>
                        <span
                          className="block text-[11px] truncate font-mono"
                          style={{ color: "var(--fg3)" }}
                        >
                          {link.url}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addSelectedLinks}
                  disabled={selectedLinks.size === 0}
                >
                  {t("webImportAddSelected", { count: selectedLinks.size })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <Select
        label={t("webImportContentFilter")}
        value={contentFilter}
        onChange={(e) => setContentFilter(e.target.value as ContentFilter)}
        disabled={importing}
      >
        <option value="fit">{t("webImportFilterReadable")}</option>
        <option value="raw">{t("webImportFilterFullPage")}</option>
        <option value="bm25">{t("webImportFilterRelevance")}</option>
      </Select>

      {contentFilter === "bm25" && (
        <Input
          label={t("webImportRelevanceQuery")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("webImportRelevanceQueryPlaceholder")}
          disabled={importing}
        />
      )}

      {task && (
        <div className="space-y-1.5">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: "var(--muted)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(4, Math.min(100, task.percent))}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <p className="text-[11.5px] font-mono" style={{ color: "var(--fg2)" }}>
            {task.message}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="submit" disabled={urlCount === 0 || importing}>
          {importing
            ? t("webImportImporting")
            : t("webImportSubmit", { count: urlCount })}
        </Button>
      </div>

      {toast && (
        <div
          className="text-[13px] rounded-[var(--radius)] px-3 py-2 border space-y-1"
          style={
            toast.kind === "success"
              ? {
                  background: "color-mix(in oklch, var(--success) 14%, transparent)",
                  borderColor: "color-mix(in oklch, var(--success) 32%, transparent)",
                  color: "var(--success)",
                }
              : {
                  background:
                    "color-mix(in oklch, var(--destructive) 12%, transparent)",
                  borderColor:
                    "color-mix(in oklch, var(--destructive) 30%, transparent)",
                  color: "var(--destructive)",
                }
          }
        >
          <div>{toast.text}</div>
          {toast.hint && <div className="text-[11.5px] opacity-80">{toast.hint}</div>}
        </div>
      )}
    </form>
  );
}
