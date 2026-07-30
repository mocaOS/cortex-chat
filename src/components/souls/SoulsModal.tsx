"use client";

import { useState } from "react";
import { AssistantSummary } from "@/types";
import Modal from "@/components/admin/Modal";
import { Button } from "@/components/admin/ui";
import SoulComposer from "./SoulComposer";
import SoulEditModal from "./SoulEditModal";
import {
  createAssistant,
  deleteAssistant,
  downloadSoul,
} from "@/lib/assistants-client";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface Props {
  open: boolean;
  onClose: () => void;
  assistants: AssistantSummary[];
  // Called after any mutation so the parent refreshes its list.
  onChanged: () => void;
}

function scopeLabel(a: AssistantSummary): string {
  if (a.scope === "builtin") return t("soulScopeBuiltin");
  if (a.scope === "global") return t("soulScopeGlobal");
  if (a.scope === "group") return t("soulScopeGroup");
  return t("soulScopePersonal");
}

export default function SoulsModal({ open, onClose, assistants, onChanged }: Props) {
  useLocale();
  const [view, setView] = useState<"list" | "add">("list");
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={() => {
        setView("list");
        onClose();
      }}
      title={view === "list" ? t("soulsTitle") : t("soulsAddTitle")}
      wide
      footer={
        view === "list" ? (
          <Button onClick={() => setView("add")}>{t("soulsAdd")}</Button>
        ) : (
          <Button variant="ghost" onClick={() => setView("list")}>
            {t("back")}
          </Button>
        )
      }
    >
      {view === "list" ? (
        <div className="space-y-2">
          {assistants.length === 0 && (
            <p className="text-[13px]" style={{ color: "var(--fg2)" }}>
              {t("soulsEmpty")}
            </p>
          )}
          {assistants.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 rounded-[var(--radius)] border px-3.5 py-3"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[13.5px] font-medium truncate"
                    style={{ color: "var(--fg1)" }}
                  >
                    {a.name}
                  </span>
                  <span
                    className="text-[10px] font-medium uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                    style={{ background: "var(--muted)", color: "var(--fg2)" }}
                  >
                    {scopeLabel(a)}
                  </span>
                  {a.verifiedSigner && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                      style={{ background: "var(--muted)", color: "var(--fg2)" }}
                      title={`${t("soulVerifiedSigner")}: ${a.verifiedSigner}`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                        <path d="M9 12l2 2 4-4" />
                      </svg>
                      {t("soulVerified")}
                    </span>
                  )}
                </div>
                {a.description && (
                  <p
                    className="text-[12px] mt-0.5 line-clamp-2"
                    style={{ color: "var(--fg2)" }}
                  >
                    {a.description}
                  </p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {a.isOwn && (
                  <button
                    onClick={() => setEditingId(a.id)}
                    className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center transition-colors"
                    style={{ color: "var(--fg3)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--fg1)";
                      e.currentTarget.style.background = "var(--muted)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--fg3)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    title={t("soulEditTitle")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => downloadSoul(a.id).catch(() => {})}
                  className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center transition-colors"
                  style={{ color: "var(--fg3)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--fg1)";
                    e.currentTarget.style.background = "var(--muted)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--fg3)";
                    e.currentTarget.style.background = "transparent";
                  }}
                  title={t("soulExport")}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M12 15V3" />
                  </svg>
                </button>
                {a.isOwn && (
                  <button
                    onClick={() => {
                      if (!confirm(t("soulDeleteConfirm"))) return;
                      deleteAssistant(a.id).then(onChanged).catch(() => {});
                    }}
                    className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center transition-colors"
                    style={{ color: "var(--fg3)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--destructive)";
                      e.currentTarget.style.background = "var(--muted)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--fg3)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    title={t("soulDelete")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1 -2 2H8a2 2 0 0 1 -2 -2L5 6" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <SoulComposer
          onSubmit={async (input) => {
            await createAssistant(input);
            onChanged();
            setView("list");
          }}
        />
      )}

      <SoulEditModal
        open={!!editingId}
        onClose={() => setEditingId(null)}
        assistantId={editingId}
        onSaved={onChanged}
      />
    </Modal>
  );
}
