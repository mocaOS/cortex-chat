"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/admin/Modal";
import {
  Button,
  ErrorBanner,
  Input,
  PasswordInput,
  Select,
  Table,
  Tabs,
  Td,
  Th,
} from "@/components/admin/ui";
import { getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

type Role = "user" | "admin" | "superadmin";
type ViewerRole = "admin" | "superadmin";

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: Role;
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

type TabKey = "users" | "registrations";

interface RegistrationRow {
  id: string;
  email: string;
  createdAt: number;
}

export default function AdminUsersPage() {
  useLocale();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [tab, setTab] = useState<TabKey>("users");
  const [approving, setApproving] = useState<RegistrationRow | null>(null);
  const [viewerRole, setViewerRole] = useState<ViewerRole>("admin");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, g, r] = await Promise.all([
        fetch("/api/admin/users").then((res) => res.json()),
        fetch("/api/admin/groups").then((res) => res.json()),
        fetch("/api/admin/registrations").then((res) => res.json()),
      ]);
      if (u.error) throw new Error(u.error);
      setUsers(u.users ?? []);
      setViewerRole((u.viewerRole as ViewerRole) ?? "admin");
      setGroups(g.groups ?? []);
      setRegistrations(r.registrations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(u: UserRow) {
    if (!confirm(t("deleteUserConfirm", { email: u.email }))) {
      return;
    }
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || t("failedToDelete"));
      return;
    }
    await load();
  }

  const emailConfigured = getCachedConfig()?.emailConfigured ?? false;

  async function handleSendReset(u: UserRow) {
    if (!confirm(t("sendResetEmailConfirm", { email: u.email }))) return;
    const res = await fetch(`/api/admin/users/${u.id}/send-reset`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || t("sendResetEmailFailed"));
      return;
    }
    alert(t("sendResetEmailSent", { email: u.email }));
  }

  async function handleDeleteRegistration(r: RegistrationRow) {
    if (!confirm(t("deleteRegistrationConfirm", { email: r.email }))) return;
    const res = await fetch(`/api/admin/registrations/${r.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || t("failedToDelete"));
      return;
    }
    await load();
  }

  function canSendReset(u: UserRow): boolean {
    if (!emailConfigured) return false;
    if (u.role === "superadmin") return false;
    if (u.role === "admin" && viewerRole !== "superadmin") return false;
    return true;
  }

  function canDelete(u: UserRow): boolean {
    if (u.role === "superadmin") return false;
    if (u.role === "admin" && viewerRole !== "superadmin") return false;
    return true;
  }

  function canEdit(u: UserRow): boolean {
    if (u.role === "superadmin") return viewerRole === "superadmin";
    if (u.role === "admin") return viewerRole === "superadmin";
    return true;
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-[24px] font-bold"
            style={{ color: "var(--fg1)", letterSpacing: "-0.015em" }}
          >
            {t("usersHeading")}
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--fg2)" }}>
            {t("usersDescription")}
          </p>
        </div>
        {tab === "users" && (
          <Button onClick={() => setEditing("new")}>{t("newUser")}</Button>
        )}
      </div>

      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "users", label: t("usersTab") },
          {
            key: "registrations",
            label:
              registrations.length > 0
                ? `${t("registrationsTab")} (${registrations.length})`
                : t("registrationsTab"),
          },
        ]}
      />

      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
          {t("loading")}
        </div>
      ) : tab === "registrations" ? (
        <RegistrationsTable
          rows={registrations}
          onApprove={setApproving}
          onDelete={handleDeleteRegistration}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("tableEmail")}</Th>
              <Th>{t("tableUsername")}</Th>
              <Th>{t("tableGroup")}</Th>
              <Th>{t("tableRole")}</Th>
              <Th>{t("actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <div>{u.email}</div>
                  {u.lastLoginAt && (
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {t("lastSeen", {
                        when: new Date(u.lastLoginAt).toLocaleString(),
                      })}
                    </div>
                  )}
                </Td>
                <Td>{u.username || "—"}</Td>
                <Td>
                  {u.groupName ?? (
                    <span className="text-[var(--text-secondary)]">
                      {t("groupNone")}
                    </span>
                  )}
                </Td>
                <Td>
                  <RoleBadge role={u.role} />
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setEditing(u)}
                      disabled={!canEdit(u)}
                    >
                      {t("edit")}
                    </Button>
                    {canSendReset(u) && (
                      <Button
                        variant="ghost"
                        onClick={() => handleSendReset(u)}
                      >
                        {t("sendResetEmail")}
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(u)}
                      disabled={!canDelete(u)}
                    >
                      {t("delete")}
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
          viewerRole={viewerRole}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {approving && (
        <ApproveDialog
          registration={approving}
          groups={groups}
          emailConfigured={emailConfigured}
          onClose={() => setApproving(null)}
          onDone={async () => {
            setApproving(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "superadmin") {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)] font-medium uppercase tracking-[0.06em]"
        style={{
          background: "var(--accent)",
          color: "var(--accent-fg)",
        }}
      >
        {t("roleSuperadmin")}
      </span>
    );
  }
  if (role === "admin") {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)] font-medium uppercase tracking-[0.06em]"
        style={{
          border: "1px solid var(--border)",
          color: "var(--fg1)",
        }}
      >
        {t("roleAdmin")}
      </span>
    );
  }
  return <span style={{ color: "var(--fg2)" }}>{t("roleUser")}</span>;
}

function UserForm({
  user,
  groups,
  viewerRole,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  groups: GroupRow[];
  viewerRole: ViewerRole;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isSuperadmin = user?.role === "superadmin";
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [groupId, setGroupId] = useState(user?.groupId ?? "");
  const [role, setRole] = useState<"user" | "admin">(
    user?.role === "admin" ? "admin" : "user"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the superadmin can assign the admin role, and only to non-superadmin targets.
  const canPickRole = viewerRole === "superadmin" && !isSuperadmin;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = isSuperadmin
        ? { groupId: groupId || null }
        : {
            email,
            username,
            groupId: groupId || null,
          };
      if (!isSuperadmin && password) body.password = password;
      if (canPickRole) body.role = role;

      // When creating, password is required.
      if (!user && !password) {
        setError(t("passwordRequiredForNew"));
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
        throw new Error(data.error || t("saveFailed"));
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        user ? t("editUserTitle", { email: user.email }) : t("newUserTitle")
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            {t("cancel")}
          </Button>
          <Button type="submit" form="user-form" disabled={saving}>
            {saving
              ? t("saving")
              : user
                ? t("saveChanges")
                : t("createUser")}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        {!isSuperadmin && (
          <>
            <Input
              label={t("tableEmail")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <Input
              label={t("usernameOptional")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <PasswordInput
              label={user ? t("newPasswordLeaveBlank") : t("password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={user ? "•••••••" : ""}
              minLength={user && !password ? 0 : 8}
              required={!user}
            />
          </>
        )}
        {canPickRole && (
          <div className="space-y-1.5">
            <Select
              label={t("tableRole")}
              value={role}
              onChange={(e) => setRole(e.target.value as "user" | "admin")}
            >
              <option value="user">{t("roleUser")}</option>
              <option value="admin">{t("roleAdmin")}</option>
            </Select>
            <p className="text-[11px]" style={{ color: "var(--fg2)" }}>
              {t("roleHint")}
            </p>
          </div>
        )}
        <Select
          label={t("tableGroup")}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          autoFocus={isSuperadmin}
        >
          <option value="">{t("noGroupOption")}</option>
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

function RegistrationsTable({
  rows,
  onApprove,
  onDelete,
}: {
  rows: RegistrationRow[];
  onApprove: (r: RegistrationRow) => void;
  onDelete: (r: RegistrationRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
        {t("registrationsEmpty")}
      </div>
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t("tableEmail")}</Th>
          <Th>{t("tableRegistered")}</Th>
          <Th>{t("actions")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{r.email}</Td>
            <Td>{new Date(r.createdAt).toLocaleString()}</Td>
            <Td>
              <div className="flex gap-2">
                <Button onClick={() => onApprove(r)}>
                  {t("confirmRegistration")}
                </Button>
                <Button variant="danger" onClick={() => onDelete(r)}>
                  {t("delete")}
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ApproveDialog({
  registration,
  groups,
  emailConfigured,
  onClose,
  onDone,
}: {
  registration: RegistrationRow;
  groups: GroupRow[];
  emailConfigured: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [groupId, setGroupId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/registrations/${registration.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: groupId || null }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("saveFailed"));
      alert(
        emailConfigured && !data.emailSent
          ? t("registrationApprovedNoEmail")
          : t("registrationApproved", { email: registration.email })
      );
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("confirmRegistrationTitle", { email: registration.email })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            {t("cancel")}
          </Button>
          <Button type="submit" form="approve-form" disabled={saving}>
            {saving ? t("confirmingRegistration") : t("confirmRegistration")}
          </Button>
        </>
      }
    >
      <form id="approve-form" onSubmit={handleSubmit} className="space-y-4">
        <Select
          label={t("tableGroup")}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          autoFocus
        >
          <option value="">{t("noGroupOption")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <p className="text-[11px]" style={{ color: "var(--fg2)" }}>
          {t("confirmRegistrationHint")}
        </p>
        <ErrorBanner message={error} />
      </form>
    </Modal>
  );
}
