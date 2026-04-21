"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/admin/Modal";
import {
  Button,
  ErrorBanner,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/ui";

interface RoleRow {
  userId: string;
  email: string;
  username: string;
  keyId: string;
  collectionIds: string[];
  createdAt: number;
}

interface Candidate {
  id: string;
  email: string;
  username: string;
  role: string;
  contentKeyId: string | null;
}

interface Collection {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
}

export default function AdminContentRolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [users, setUsers] = useState<Candidate[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, u, c] = await Promise.all([
        fetch("/api/admin/content-roles").then((x) => x.json()),
        fetch("/api/admin/users").then((x) => x.json()),
        fetch("/api/admin/collections").then((x) => x.json()),
      ]);
      if (r.error) throw new Error(r.error);
      setRoles(r.roles ?? []);
      setUsers(u.users ?? []);
      setCollections(c.collections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(userId: string, email: string) {
    if (
      !confirm(`Revoke upload permission for ${email}? The backend key will be deleted.`)
    ) {
      return;
    }
    const res = await fetch(`/api/admin/content-roles/${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to revoke");
      return;
    }
    await load();
  }

  const eligibleUsers = users.filter(
    (u) => u.role !== "superadmin" && !u.contentKeyId
  );

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1
            className="text-[24px] font-bold"
            style={{ color: "var(--fg1)", letterSpacing: "-0.015em" }}
          >
            Content roles
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--fg2)" }}>
            Grant individual users permission to upload documents to selected
            collections. Each role mints a backend key with{" "}
            <code
              className="text-[12px] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
              style={{
                background: "var(--muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              manage
            </code>{" "}
            permission.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          disabled={eligibleUsers.length === 0}
          title={
            eligibleUsers.length === 0
              ? "No eligible users left — all non-admin users already have a content role."
              : undefined
          }
        >
          Grant role
        </Button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
          Loading…
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Collections</Th>
              <Th>Granted</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 && (
              <tr>
                <Td className="text-[var(--text-secondary)]">
                  No content roles granted yet.
                </Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
              </tr>
            )}
            {roles.map((r) => (
              <tr key={r.keyId}>
                <Td>
                  <div>{r.email}</div>
                  {r.username && (
                    <div className="text-xs text-[var(--text-secondary)]">
                      {r.username}
                    </div>
                  )}
                </Td>
                <Td>
                  {r.collectionIds.length === 0 ? (
                    <span className="text-[var(--text-secondary)]">
                      All collections
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.collectionIds.map((cid) => {
                        const c = collections.find((x) => x.id === cid);
                        return (
                          <span
                            key={cid}
                            className="text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)]"
                            style={{
                              background: "var(--muted)",
                              color: "var(--fg1)",
                            }}
                          >
                            {c?.name ?? cid}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </Td>
                <Td
                  style={{ color: "var(--fg2)", fontFamily: "var(--font-mono)" }}
                  className="text-[12px]"
                >
                  {new Date(r.createdAt).toLocaleDateString()}
                </Td>
                <Td>
                  <Button
                    variant="danger"
                    onClick={() => revoke(r.userId, r.email)}
                  >
                    Revoke
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {creating && (
        <ContentRoleForm
          users={eligibleUsers}
          collections={collections}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ContentRoleForm({
  users,
  collections,
  onClose,
  onSaved,
}: {
  users: Candidate[];
  collections: Collection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [allCollections, setAllCollections] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const collectionIds = allCollections ? [] : Array.from(selected);
    try {
      const res = await fetch("/api/admin/content-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, collectionIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Grant content role"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="role-form" disabled={saving || !userId}>
            {saving ? "Saving…" : "Grant role"}
          </Button>
        </>
      }
    >
      <form id="role-form" onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="User"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
              {u.username ? ` (${u.username})` : ""}
            </option>
          ))}
        </Select>

        <div className="space-y-2">
          <div
            className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
            style={{ color: "var(--fg2)" }}
          >
            Collections this user can upload to
          </div>
          <label
            className="flex items-center gap-2 text-[13px] cursor-pointer"
            style={{ color: "var(--fg1)" }}
          >
            <input
              type="checkbox"
              checked={allCollections}
              onChange={(e) => setAllCollections(e.target.checked)}
            />
            <span>All collections</span>
          </label>

          <div
            className={`rounded-[var(--radius)] max-h-64 overflow-y-auto border divide-y ${
              allCollections ? "opacity-50 pointer-events-none" : ""
            }`}
            style={{
              borderColor: "var(--border)",
              background: "var(--bg)",
            }}
          >
            {collections.length === 0 ? (
              <div
                className="px-3 py-4 text-[13px]"
                style={{ color: "var(--fg2)" }}
              >
                No collections returned from the library backend.
              </div>
            ) : (
              collections.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--muted)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <div
                    className="flex-1 text-[13px]"
                    style={{ color: "var(--fg1)" }}
                  >
                    {c.name}
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        <ErrorBanner message={error} />
      </form>
    </Modal>
  );
}
