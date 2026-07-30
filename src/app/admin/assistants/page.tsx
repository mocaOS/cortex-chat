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
                  {a.description && (
                    <div
                      className="text-xs mt-0.5 max-w-[320px] truncate"
                      style={{ color: "var(--fg2)" }}
                      title={a.description}
                    >
                      {a.description}
                    </div>
                  )}
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
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="ghost" onClick={() => setEditingId(a.id)}>
                      {t("soulEdit")}
                    </Button>
                    <Button variant="ghost" onClick={() => toggle(a)}>
                      {a.enabled
                        ? a.builtinKey
                          ? t("soulRemove")
                          : t("soulDisable")
                        : t("soulRestore")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => downloadSoul(a.id, true).catch(() => {})}
                    >
                      {t("soulExport")}
                    </Button>
                    {!a.builtinKey && (
                      <Button variant="danger" onClick={() => remove(a)}>
                        {t("soulDelete")}
                      </Button>
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
