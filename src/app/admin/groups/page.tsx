"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/admin/Modal";
import {
  Button,
  ErrorBanner,
  Input,
  Table,
  Td,
  Textarea,
  Th,
} from "@/components/admin/ui";

interface GroupRow {
  id: string;
  name: string;
  description: string;
  collectionIds: string[];
  memberCount: number;
}

interface Collection {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
}

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GroupRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, c] = await Promise.all([
        fetch("/api/admin/groups").then((r) => r.json()),
        fetch("/api/admin/collections").then((r) => r.json()),
      ]);
      if (g.error) throw new Error(g.error);
      if (c.error) throw new Error(c.error);
      setGroups(g.groups ?? []);
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

  async function handleDelete(id: string) {
    if (
      !confirm(
        "Delete this group? The backend API key will be revoked and members will lose chat access."
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/groups/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete");
      return;
    }
    await load();
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">User groups</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Groups bundle users under a read-only backend key scoped to a set
            of collections. Each user belongs to exactly one group.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>New group</Button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Members</Th>
              <Th>Collections</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <Td className="text-[var(--text-secondary)]">
                  No groups yet.
                </Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.id}>
                <Td>
                  <div className="font-medium">{g.name}</div>
                  {g.description && (
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {g.description}
                    </div>
                  )}
                </Td>
                <Td>{g.memberCount}</Td>
                <Td>
                  {g.collectionIds.length === 0 ? (
                    <span className="text-[var(--text-secondary)]">
                      All collections
                    </span>
                  ) : (
                    <span>{g.collectionIds.length} scoped</span>
                  )}
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setEditing(g)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => handleDelete(g.id)}
                      className="hover:!text-red-400"
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <GroupForm
          group={editing === "new" ? null : editing}
          collections={collections}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function GroupForm({
  group,
  collections,
  onClose,
  onSaved,
}: {
  group: GroupRow | null;
  collections: Collection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [allCollections, setAllCollections] = useState(
    (group?.collectionIds.length ?? 0) === 0
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(group?.collectionIds ?? [])
  );
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
      const res = await fetch(
        group ? `/api/admin/groups/${group.id}` : "/api/admin/groups",
        {
          method: group ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, collectionIds }),
        }
      );
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
      title={group ? `Edit group — ${group.name}` : "New group"}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            type="submit"
            form="group-form"
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : group ? "Save changes" : "Create group"}
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <Textarea
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />

        <div className="space-y-2">
          <div className="text-xs text-[var(--text-secondary)]">
            Collections
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allCollections}
              onChange={(e) => setAllCollections(e.target.checked)}
            />
            <span>Access to all collections</span>
          </label>

          <div
            className={`border border-[var(--border)] rounded-lg max-h-64 overflow-y-auto divide-y divide-[var(--border)] ${
              allCollections ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {collections.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[var(--text-secondary)]">
                No collections returned from the library backend.
              </div>
            ) : (
              collections.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--bg-tertiary)]/30"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <div className="flex-1">
                    <div className="text-sm">{c.name}</div>
                    {c.description && (
                      <div className="text-xs text-[var(--text-secondary)]">
                        {c.description}
                      </div>
                    )}
                  </div>
                  {typeof c.document_count === "number" && (
                    <div className="text-xs text-[var(--text-secondary)]">
                      {c.document_count} docs
                    </div>
                  )}
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
