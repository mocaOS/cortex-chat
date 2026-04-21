"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getConfig } from "@/lib/config";
import { CurrentUser } from "@/types/auth";
import { Button, ErrorBanner, Select } from "@/components/admin/ui";

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

export default function UploadPage() {
  const router = useRouter();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [logoUrl, setLogoUrl] = useState("/logo.svg");
  const [ready, setReady] = useState(false);

  const loadScope = useCallback(async () => {
    const res = await fetch("/api/me/upload-scope");
    if (res.status === 403) {
      setError("You do not have upload permission.");
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
    getConfig().then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.svg"));
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return (await res.json()) as CurrentUser;
      })
      .then((u) => {
        if (!u) return;
        if (!u.canUpload) {
          router.replace("/");
          return;
        }
        setMe(u);
        loadScope();
      })
      .finally(() => setReady(true));
  }, [router, loadScope]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setToast(null);

    const form = new FormData();
    form.append("file", file);
    if (collectionId) form.append("collection_id", collectionId);

    try {
      const res = await fetch("/api/me/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setToast({
        kind: "success",
        text: `"${file.name}" uploaded.`,
      });
      setFile(null);
      const input = document.getElementById("upload-file") as
        | HTMLInputElement
        | null;
      if (input) input.value = "";
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  }

  if (!ready || !me) {
    return <div className="h-dvh bg-[var(--bg-primary)]" />;
  }

  return (
    <div className="h-dvh flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <Link href="/" className="flex items-center gap-3">
          <img src={logoUrl} alt="Logo" className="h-7 w-auto" />
        </Link>
        <Link
          href="/"
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ← Back to chat
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-10 space-y-6">
          <div>
            <h1 className="text-xl font-semibold">Upload documents</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Pick a collection and upload a document. You&apos;ll get a
              confirmation when the file is received. Processing happens in the
              background and isn&apos;t shown here.
            </p>
          </div>

          <ErrorBanner message={error} />

          {!error && (
            <form
              onSubmit={handleUpload}
              className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-5 space-y-4"
            >
              <Select
                label="Collection"
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
              >
                {collections.length === 0 && (
                  <option value="">No collections available</option>
                )}
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>

              <label className="block space-y-1.5">
                <span className="text-xs text-[var(--text-secondary)]">
                  File
                </span>
                <input
                  id="upload-file"
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-[var(--text-primary)] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--bg-tertiary)] file:text-sm file:text-[var(--text-primary)] file:cursor-pointer"
                  accept=".pdf,.docx,.txt,.md"
                />
                <span className="text-xs text-[var(--text-secondary)]">
                  Supported: PDF, DOCX, TXT, MD.
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="submit"
                  disabled={!file || uploading || !collectionId}
                >
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              </div>
            </form>
          )}

          {toast && (
            <div
              className={`text-sm rounded-lg px-3 py-2 border ${
                toast.kind === "success"
                  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                  : "text-red-400 bg-red-500/10 border-red-500/30"
              }`}
            >
              {toast.text}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
