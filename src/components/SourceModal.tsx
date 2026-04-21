"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Source } from "@/types";
import { fetchDocumentContent } from "@/lib/api";
import { t } from "@/lib/i18n";

interface Props {
  source: Source;
  onClose: () => void;
}

export default function SourceModal({ source, onClose }: Props) {
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const doc = await fetchDocumentContent(source.document_id);
        if (cancelled) return;

        const chunkContents = doc.chunks
          .sort((a, b) => a.chunk_index - b.chunk_index)
          .map((c) => c.content);
        setFullContent(chunkContents.join("\n\n"));
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [source.document_id]);

  // Scroll to highlighted chunk once content loads
  useEffect(() => {
    if (fullContent && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [fullContent]);

  // Build content with the cited chunk highlighted
  function renderContent() {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12 text-[var(--text-secondary)] text-sm">
          <svg className="w-4 h-4 animate-spin mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          Loading document...
        </div>
      );
    }

    if (error || !fullContent) {
      // Fallback to chunk content
      return (
        <div className="markdown-content text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {source.content}
          </ReactMarkdown>
        </div>
      );
    }

    // Split full content around the cited chunk to highlight it
    const chunkText = source.content.trim();
    const idx = fullContent.indexOf(chunkText);

    if (idx === -1) {
      // Chunk not found in assembled text, render full doc without highlight
      return (
        <div className="markdown-content text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {fullContent}
          </ReactMarkdown>
        </div>
      );
    }

    const before = fullContent.slice(0, idx);
    const after = fullContent.slice(idx + chunkText.length);

    return (
      <>
        {before && (
          <div className="markdown-content text-sm opacity-60">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {before}
            </ReactMarkdown>
          </div>
        )}
        <div
          ref={highlightRef}
          className="markdown-content text-sm border-l-3 pl-4 py-2 my-2"
          style={{ borderColor: "var(--accent)" }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {chunkText}
          </ReactMarkdown>
        </div>
        {after && (
          <div className="markdown-content text-sm opacity-60">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {after}
            </ReactMarkdown>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--accent)" }}
            >
              <svg
                className="w-4 h-4 text-black"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">
                {source.metadata.filename}
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                {t("relevance")}: {(source.score * 100).toFixed(0)}%
                {source.metadata.rerank_score !== undefined &&
                  ` · ${t("rerank")}: ${(source.metadata.rerank_score * 100).toFixed(0)}%`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
