"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorBanner, Select } from "@/components/admin/ui";
import { t } from "@/lib/i18n";
import { rateLimitMessage } from "@/lib/rate-limit-message";
import { getConfig } from "@/lib/config";
import WebImportForm from "./WebImportForm";

type Mode = "file" | "web";

function formatMaxBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileStatus = "queued" | "uploading" | "done" | "error" | "skipped";

interface FileItem {
  file: File;
  status: FileStatus;
  message?: string;
}

interface Collection {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
}

interface Toast {
  kind: "success" | "error";
  text: string;
}

export default function UploadTab() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState<string>("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mode, setMode] = useState<Mode>("file");
  const [webEnabled, setWebEnabled] = useState(false);

  // Web Import is gated on the backend (ENABLE_WEB_CRAWL + a crawl service).
  // /api/features reports the resolved flag; hide the toggle when it's off.
  useEffect(() => {
    fetch("/api/proxy/api/features")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setWebEnabled(Boolean(data?.enable_web_crawl)))
      .catch(() => setWebEnabled(false));
  }, []);

  const loadScope = useCallback(async () => {
    const res = await fetch("/api/me/upload-scope");
    if (res.status === 403) {
      setError(t("noUploadPermission"));
      setCollections([]);
      return;
    }
    const data = await res.json();
    if (data.error) {
      setError(data.error);
      return;
    }
    setCollections(data.collections ?? []);
    if (data.collections?.length > 0) {
      setCollectionId(data.collections[0].id);
    }
  }, []);

  useEffect(() => {
    loadScope();
  }, [loadScope]);

  function setItemStatus(index: number, status: FileStatus, message?: string) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, status, message } : it))
    );
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    setUploading(true);
    setError(null);
    setToast(null);

    const cfg = await getConfig();
    const total = items.length;
    let doneCount = 0;
    // A 429/507 affects the whole batch — stop instead of hammering the backend.
    let stopReason: string | null = null;

    for (let i = 0; i < total; i++) {
      const { file } = items[i];

      // Re-submit after a partial failure: don't re-upload what already landed
      // (the backend would 409 it as a duplicate).
      if (items[i].status === "done") {
        doneCount++;
        continue;
      }

      if (stopReason) {
        setItemStatus(i, "skipped", stopReason);
        continue;
      }

      if (file.size > cfg.maxUploadBytes) {
        setItemStatus(
          i,
          "error",
          t("fileTooLarge", { max: formatMaxBytes(cfg.maxUploadBytes) })
        );
        continue;
      }

      setProgress({ current: i + 1, total });
      setItemStatus(i, "uploading");

      const form = new FormData();
      form.append("file", file);
      if (collectionId) form.append("collection_id", collectionId);

      try {
        const res = await fetch("/api/me/upload", {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          // Burst rate limit or monthly unit quota — Retry-After tells them apart.
          const retryAfter = res.headers.get("Retry-After");
          stopReason = rateLimitMessage(
            retryAfter && Number.isFinite(Number(retryAfter))
              ? Number(retryAfter)
              : null
          );
          setItemStatus(i, "error", stopReason);
          continue;
        }
        if (res.status === 507) {
          // Backend disk-free guardrail (MIN_FREE_DISK_MB) refused the upload.
          stopReason = t("serverStorageFull");
          setItemStatus(i, "error", stopReason);
          continue;
        }
        if (!res.ok) throw new Error(data.error || t("uploadFailed"));
        doneCount++;
        setItemStatus(i, "done");
      } catch (err) {
        setItemStatus(
          i,
          "error",
          err instanceof Error ? err.message : t("uploadFailed")
        );
      }
    }

    setProgress(null);
    setUploading(false);

    const input = document.getElementById("upload-file") as
      | HTMLInputElement
      | null;
    if (input) input.value = "";

    if (doneCount === total) {
      setToast({
        kind: "success",
        text:
          total === 1
            ? t("fileUploaded", { name: items[0].file.name })
            : t("filesUploaded", { count: String(total) }),
      });
      setItems([]);
    } else {
      // Keep the list visible so per-file errors stay readable.
      setToast({
        kind: "error",
        text: t("uploadPartial", {
          ok: String(doneCount),
          total: String(total),
        }),
      });
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <p className="text-[13px]" style={{ color: "var(--fg2)" }}>
        {mode === "web" ? t("webImportDescription") : t("uploadDescription")}
      </p>

      <ErrorBanner message={error} />

      {!error && webEnabled && (
        <div
          className="inline-flex rounded-[var(--radius)] border p-0.5"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
          role="tablist"
        >
          {(["file", "web"] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m)}
                className="px-3.5 py-1.5 text-[12px] rounded-[calc(var(--radius)-2px)] transition-colors"
                style={{
                  background: active ? "var(--muted)" : "transparent",
                  color: active ? "var(--fg1)" : "var(--fg2)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {m === "file" ? t("webImportModeFile") : t("webImportModeWeb")}
              </button>
            );
          })}
        </div>
      )}

      {!error && mode === "web" && (
        <WebImportForm
          collections={collections}
          collectionId={collectionId}
          setCollectionId={setCollectionId}
        />
      )}

      {!error && mode === "file" && (
        <form
          onSubmit={handleUpload}
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

          <label className="block space-y-1.5">
            <span
              className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--fg2)" }}
            >
              {t("file")}
            </span>
            <input
              id="upload-file"
              type="file"
              multiple
              onChange={(e) => {
                setToast(null);
                setItems(
                  Array.from(e.target.files ?? []).map((file) => ({
                    file,
                    status: "queued" as FileStatus,
                  }))
                );
              }}
              className="w-full text-[13px] file:mr-3 file:px-3 file:py-1.5 file:rounded-[var(--radius)] file:border file:text-[13px] file:cursor-pointer"
              style={{ color: "var(--fg1)" }}
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.html,.htm,.txt,.md,.mdx,.markdown,.rst,.tex,.latex,.xml,.epub,.png,.jpg,.jpeg,.tiff,.tif,.bmp,.wav,.mp3,.webvtt,.vtt"
            />
            <span className="text-[12px]" style={{ color: "var(--fg2)" }}>
              {t("supportedFormats")}
            </span>
          </label>

          {items.length > 0 && (
            <ul
              className="rounded-[var(--radius)] border divide-y max-h-56 overflow-y-auto"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-primary)",
              }}
            >
              {items.map((it, i) => (
                <li
                  key={`${it.file.name}-${i}`}
                  className="flex items-start gap-3 px-3 py-2"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[13px]"
                      style={{ color: "var(--fg1)" }}
                    >
                      {it.file.name}
                    </div>
                    {it.message && (
                      <div
                        className="text-[11.5px] mt-0.5"
                        style={{
                          color:
                            it.status === "error"
                              ? "var(--destructive)"
                              : "var(--fg2)",
                        }}
                      >
                        {it.message}
                      </div>
                    )}
                  </div>
                  <span
                    className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] pt-0.5"
                    style={{
                      color:
                        it.status === "done"
                          ? "var(--success)"
                          : it.status === "error"
                            ? "var(--destructive)"
                            : it.status === "uploading"
                              ? "var(--accent)"
                              : "var(--fg2)",
                    }}
                  >
                    {it.status === "queued" && formatFileSize(it.file.size)}
                    {it.status === "uploading" && t("fileStatusUploading")}
                    {it.status === "done" && t("fileStatusDone")}
                    {it.status === "error" && t("fileStatusError")}
                    {it.status === "skipped" && t("fileStatusSkipped")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="submit"
              disabled={items.length === 0 || uploading || !collectionId}
            >
              {uploading
                ? progress && progress.total > 1
                  ? t("uploadingProgress", {
                      current: String(progress.current),
                      total: String(progress.total),
                    })
                  : t("uploading")
                : t("upload")}
            </Button>
          </div>
        </form>
      )}

      {toast && mode === "file" && (
        <div
          className="text-[13px] rounded-[var(--radius)] px-3 py-2 border space-y-1"
          style={
            toast.kind === "success"
              ? {
                  background: "color-mix(in oklch, var(--success) 14%, transparent)",
                  borderColor:
                    "color-mix(in oklch, var(--success) 32%, transparent)",
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
          {toast.kind === "success" && (
            <div className="text-[11.5px] opacity-80">
              {t("processingStartedHint")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
