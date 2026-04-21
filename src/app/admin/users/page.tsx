"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/admin/Modal";
import {
  Button,
  ErrorBanner,
  Input,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/ui";

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: "user" | "superadmin";
  groupId: string | null;
  groupName: string | null;
  contentKeyId: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

interface GroupRow {
  id: string;
  name: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, g] = await Promise.all([
        fetch("/api/admin/users").then((r) => r.json()),
        fetch("/api/admin/groups").then((r) => r.json()),
      ]);
      if (u.error) throw new Error(u.error);
      setUsers(u.users ?? []);
      setGroups(g.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(u: UserRow) {
    if (!confirm(`Delete user ${u.email}? This also deletes their chat history.`)) {
      return;
    }
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
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
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Each user signs in with their email + password and inherits the
            chat scope of their assigned group.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>New user</Button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Username</Th>
              <Th>Group</Th>
              <Th>Role</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <div>{u.email}</div>
                  {u.lastLoginAt && (
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Last seen {new Date(u.lastLoginAt).toLocaleString()}
                    </div>
                  )}
                </Td>
                <Td>{u.username || "—"}</Td>
                <Td>
                  {u.groupName ?? (
                    <span className="text-[var(--text-secondary)]">None</span>
                  )}
                </Td>
                <Td>
                  {u.role === "superadmin" ? (
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: "var(--accent)", color: "#000" }}
                    >
                      superadmin
                    </span>
                  ) : (
                    "user"
                  )}
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setEditing(u)}
                      disabled={u.role === "superadmin"}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => handleDelete(u)}
                      disabled={u.role === "superadmin"}
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
        <UserForm
          user={editing === "new" ? null : editing}
          groups={groups}
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

function UserForm({
  user,
  groups,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  groups: GroupRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [groupId, setGroupId] = useState(user?.groupId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        email,
        username,
        groupId: groupId || null,
      };
      if (password) body.password = password;

      // When creating, password is required.
      if (!user && !password) {
        setError("Password is required for new users.");
        setSaving(false);
        return;
      }

      const res = await fetch(
        user ? `/api/admin/users/${user.id}` : "/api/admin/users",
        {
          method: user ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
      title={user ? `Edit user — ${user.email}` : "New user"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={saving}>
            {saving ? "Saving…" : user ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Username (optional)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          label={user ? "New password (leave blank to keep)" : "Password"}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={user ? "•••••••" : ""}
          minLength={user && !password ? 0 : 8}
          required={!user}
        />
        <Select
          label="Group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          <option value="">— No group (no chat access) —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <ErrorBanner message={error} />
      </form>
    </Modal>
  );
}
