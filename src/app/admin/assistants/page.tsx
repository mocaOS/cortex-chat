"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorBanner,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/ui";
import Modal from "@/components/admin/Modal";
import SoulComposer from "@/components/souls/SoulComposer";
import SoulEditModal from "@/components/souls/SoulEditModal";
import { downloadSoul } from "@/lib/assistants-client";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface AdminAssistant {
  id: string;
  name: string;
  description: string;
  scope: "builtin" | "global" | "group" | "user";
  builtinKey: string | null;
  groupId: string | null;
  enabled: boolean;
  verifiedSigner: string | null;
  isOwn: boolean;
}

interface Group {
  id: string;
  name: string;
}

export default function AdminAssistantsPage() {
  useLocale();
  const [rows, setRows] = useState<AdminAssistant[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newScope, setNewScope] = useState<"global" | "group">("global");
  const [newGroupId, setNewGroupId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, g] = await Promise.all([
        fetch("/api/admin/assistants").then((r) => r.json()),
        fetch("/api/admin/groups").then((r) => r.json()),
      ]);
      if (a.error) throw new Error(a.error);
      setRows(a.assistants ?? []);
      setGroups(g.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(a: AdminAssistant) {
    await fetch(`/api/admin/assistants/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    load();
  }

  async function remove(a: AdminAssistant) {
    if (!confirm(t("soulDeleteConfirm"))) return;
    const res = await fetch(`/api/admin/assistants/${a.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || t("failedToRemove"));
      return;
    }
    load();
  }

  function scopeLabel(a: AdminAssistant): string {
    if (a.scope === "builtin") return t("soulScopeBuiltin");
    if (a.scope === "global") return t("soulScopeGlobal");
    if (a.scope === "group") {
      const g = groups.find((x) => x.id === a.groupId);
      return g ? `${t("soulScopeGroup")}: ${g.name}` : t("soulScopeGroup");
    }
    return t("soulScopePersonal");
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1
            className="text-[24px] font-bold"
            style={{ color: "var(--fg1)", letterSpacing: "-0.015em" }}
          >
            {t("adminSoulsHeading")}
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--fg2)" }}>
            {t("adminSoulsDescription")}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>{t("soulsAdd")}</Button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
          {t("loading")}
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("soulName")}</Th>
              <Th>{t("soulScope")}</Th>
              <Th>{t("soulStatus")}</Th>
              <Th>{t("actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <Td className="text-[var(--text-secondary)]">{t("soulsEmpty")}</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id}>
                <Td>
                  <div className="font-medium" style={{ color: "var(--fg1)" }}>
                    {a.name}
                    {a.verifiedSigner && (
                      <span
                        className="ml-2 text-[10px] font-medium uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                        style={{ background: "var(--muted)", color: "var(--fg2)" }}
                        title={`${t("soulVerifiedSigner")}: ${a.verifiedSigner}`}
                      >
                        {t("soulVerified")}
                      </span>
                    )}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-[var(--text-secondary)]">
                  {scopeLabel(a)}
                </Td>
                <Td>
                  <span
                    className="text-[11px] font-medium uppercase tracking-[0.06em]"
                    style={{
                      color: a.enabled ? "var(--success)" : "var(--fg3)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {a.enabled ? t("soulEnabled") : t("soulDisabled")}
                  </span>
                </Td>
                <Td>
                  <div className="flex gap-0.5">
                    <IconBtn label={t("soulEditTitle")} onClick={() => setEditingId(a.id)}>
                      {/* pencil */}
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </IconBtn>
                    <IconBtn
                      label={
                        a.enabled
                          ? a.builtinKey
                            ? t("soulRemove")
                            : t("soulDisable")
                          : t("soulRestore")
                      }
                      onClick={() => toggle(a)}
                    >
                      {a.enabled ? (
                        /* eye-off — hide from users */
                        <>
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <path d="M2 2l20 20" />
                          <path d="M9.9 9.9a3 3 0 1 0 4.24 4.24" />
                        </>
                      ) : (
                        /* eye — make visible again */
                        <>
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </IconBtn>
                    <IconBtn
                      label={t("soulExport")}
                      onClick={() => downloadSoul(a.id, true).catch(() => {})}
                    >
                      {/* download */}
                      <>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <path d="M7 10l5 5 5-5" />
                        <path d="M12 15V3" />
                      </>
                    </IconBtn>
                    {!a.builtinKey && (
                      <IconBtn label={t("soulDelete")} danger onClick={() => remove(a)}>
                        {/* trash */}
                        <>
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1 -2 2H8a2 2 0 0 1 -2 -2L5 6" />
                        </>
                      </IconBtn>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("soulsAddTitle")}
        wide
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label={t("soulVisibility")}
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as "global" | "group")}
            >
              <option value="global">{t("soulScopeGlobal")}</option>
              <option value="group">{t("soulScopeGroup")}</option>
            </Select>
            {newScope === "group" && (
              <Select
                label={t("tableGroup")}
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
              >
                <option value="">{t("selectGroup")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <SoulComposer
            onSubmit={async (input) => {
              const res = await fetch("/api/admin/assistants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...input,
                  scope: newScope,
                  ...(newScope === "group" ? { groupId: newGroupId } : {}),
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                throw new Error(data.error || t("saveFailed"));
              }
              setAddOpen(false);
              load();
            }}
          />
        </div>
      </Modal>

      <SoulEditModal
        open={!!editingId}
        onClose={() => setEditingId(null)}
        assistantId={editingId}
        admin
        onSaved={load}
      />
    </div>
  );
}

// Compact icon action for table rows — label lives in the tooltip so four
// actions fit one cell without breaking the layout.
function IconBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center transition-colors cursor-pointer"
      style={{ color: "var(--fg3)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger ? "var(--destructive)" : "var(--fg1)";
        e.currentTarget.style.background = "var(--muted)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--fg3)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
