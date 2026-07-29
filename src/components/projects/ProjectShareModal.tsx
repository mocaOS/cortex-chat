"use client";

import { useEffect, useRef, useState } from "react";
import { ProjectInfo } from "@/types";
import Modal from "@/components/admin/Modal";
import { Button, ErrorBanner } from "@/components/admin/ui";
import {
  DirectoryResult,
  putProjectShares,
  searchDirectory,
} from "@/lib/projects-client";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface Chip {
  key: string; // g:<id> | u:<id>
  label: string;
  groupId?: string;
  userId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  project: ProjectInfo | null;
  onSaved: () => void;
}

// One search field matching groups AND people; picked entries become chips.
export default function ProjectShareModal({ open, onClose, project, onSaved }: Props) {
  useLocale();
  const [chips, setChips] = useState<Chip[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open && project) {
      setChips(
        (project.shares ?? []).map((s) =>
          s.groupId
            ? { key: `g:${s.groupId}`, label: s.groupName ?? "?", groupId: s.groupId }
            : {
                key: `u:${s.userId}`,
                label: s.username || s.userEmail || "?",
                userId: s.userId ?? undefined,
              }
        )
      );
      setQuery("");
      setResults(null);
      setError(null);
    }
  }, [open, project]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchDirectory(query.trim())
        .then(setResults)
        .catch(() => setResults(null));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function addChip(chip: Chip) {
    setChips((prev) => (prev.some((c) => c.key === chip.key) ? prev : [...prev, chip]));
    setQuery("");
    setResults(null);
  }

  async function save() {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      await putProjectShares(
        project.id,
        chips.map((c) => (c.groupId ? { groupId: c.groupId } : { userId: c.userId! }))
      );
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
      title={`${t("projectShareTitle")}: ${project?.name ?? ""}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner message={error} />
        <p className="text-[12.5px]" style={{ color: "var(--fg2)" }}>
          {t("projectShareHint")}
        </p>

        {/* Selected chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-[12px]"
                style={{ background: "var(--muted)", color: "var(--fg1)" }}
              >
                {c.groupId && (
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--fg2)" }}>
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                )}
                <span className="truncate max-w-[160px]">{c.label}</span>
                <button
                  onClick={() => setChips((prev) => prev.filter((x) => x.key !== c.key))}
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ color: "var(--fg3)" }}
                  aria-label={t("remove")}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("projectSharePlaceholder")}
            className="w-full rounded-[var(--radius)] px-3 py-2 text-[13px] outline-none border placeholder:text-[var(--fg3)]"
            style={{
              background: "var(--bg)",
              borderColor: "var(--input)",
              color: "var(--fg1)",
            }}
          />
          {results && (results.groups.length > 0 || results.users.length > 0) && (
            <div
              className="absolute z-10 mt-1 w-full rounded-[var(--radius)] border overflow-hidden shadow-lg"
              style={{ background: "var(--popover)", borderColor: "var(--border)" }}
            >
              {results.groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() =>
                    addChip({ key: `g:${g.id}`, label: g.name, groupId: g.id })
                  }
                  className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2"
                  style={{ color: "var(--fg1)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--muted)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--fg2)" }}>
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span className="flex-1 truncate">{g.name}</span>
                  <span
                    className="text-[10px] uppercase tracking-[0.06em]"
                    style={{ color: "var(--fg3)", fontFamily: "var(--font-mono)" }}
                  >
                    {t("soulScopeGroup")}
                  </span>
                </button>
              ))}
              {results.users.map((u) => (
                <button
                  key={u.id}
                  onClick={() =>
                    addChip({
                      key: `u:${u.id}`,
                      label: u.username || u.email,
                      userId: u.id,
                    })
                  }
                  className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2"
                  style={{ color: "var(--fg1)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--muted)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--fg2)" }}>
                    <circle cx="12" cy="8" r="4" />
                    <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
                  </svg>
                  <span className="flex-1 truncate">
                    {u.username || u.email}
                    {u.username && (
                      <span className="ml-1.5" style={{ color: "var(--fg3)" }}>
                        {u.email}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
