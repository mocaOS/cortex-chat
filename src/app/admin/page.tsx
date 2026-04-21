"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  ErrorBanner,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/ui";

interface SeriesPoint {
  day: string;
  logins: number;
  messages: number;
  uploads: number;
}

interface TopUser {
  userId: string | null;
  email: string | null;
  username: string | null;
  lastLoginAt: number | null;
  n: number;
  logins: number;
}

interface Analytics {
  days: number;
  totals: {
    logins: number;
    messages: number;
    uploads: number;
    activeUsers: number;
  };
  series: SeriesPoint[];
  topUsers: TopUser[];
}

interface LoginEventRow {
  id: string;
  createdAt: number;
  success: number;
  emailAttempted: string;
  ip: string;
  userAgent: string;
  userEmail: string | null;
  username: string | null;
}

const RANGES = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

const LOGIN_PAGE = 50;

type TabKey = "top-users" | "login-history";

export default function AdminDashboard() {
  const [days, setDays] = useState(30);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [counts, setCounts] = useState<{
    users: number;
    groups: number;
    uploaders: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("top-users");

  // Login history state (only fetched when its tab is active).
  const [logins, setLogins] = useState<LoginEventRow[]>([]);
  const [loginOffset, setLoginOffset] = useState(0);
  const [loginHasMore, setLoginHasMore] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const loadAnalytics = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const [a, u, g] = await Promise.all([
        fetch(`/api/admin/analytics?days=${d}`).then((r) => r.json()),
        fetch("/api/admin/users").then((r) => r.json()),
        fetch("/api/admin/groups").then((r) => r.json()),
      ]);
      if (a.error) throw new Error(a.error);
      setAnalytics(a);
      const users = u.users ?? [];
      setCounts({
        users: users.length,
        groups: (g.groups ?? []).length,
        uploaders: users.filter((x: { contentKeyId: string | null }) => x.contentKeyId)
          .length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogins = useCallback(async (off: number) => {
    setLoginLoading(true);
    try {
      const res = await fetch(
        `/api/admin/login-events?limit=${LOGIN_PAGE}&offset=${off}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setLogins(data.events);
      setLoginHasMore(data.events.length === LOGIN_PAGE);
      setLoginOffset(off);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoginLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics(days);
  }, [days, loadAnalytics]);

  useEffect(() => {
    if (tab === "login-history" && logins.length === 0) {
      loadLogins(0);
    }
  }, [tab, logins.length, loadLogins]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Snapshot of system activity. Use the side nav to manage users,
            groups, and content roles.
          </p>
        </div>
        <div className="w-48">
          <Select
            label="Range"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading || !analytics || !counts ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Kpi label="Users" value={counts.users} />
            <Kpi label="Groups" value={counts.groups} />
            <Kpi label="Uploaders" value={counts.uploaders} />
            <Kpi label="Active" value={analytics.totals.activeUsers} />
            <Kpi label="Logins" value={analytics.totals.logins} />
            <Kpi label="Messages" value={analytics.totals.messages} />
            <Kpi label="Uploads" value={analytics.totals.uploads} />
          </div>

          <section className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
            <div className="text-sm font-medium mb-3">Daily activity</div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis
                    dataKey="day"
                    stroke="#a0a0a0"
                    fontSize={11}
                    tickMargin={6}
                  />
                  <YAxis stroke="#a0a0a0" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#141414",
                      border: "1px solid #2a2a2a",
                      borderRadius: 8,
                      color: "#f5f5f5",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="messages"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="logins"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="uploads"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 text-xs text-[var(--text-secondary)] pt-2">
              <Legend color="var(--accent)" label="Messages" />
              <Legend color="#a78bfa" label="Logins" />
              <Legend color="#34d399" label="Uploads" />
            </div>
          </section>

          <section className="space-y-3">
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { key: "top-users", label: "Top users" },
                { key: "login-history", label: "Login history" },
              ]}
            />
            {tab === "top-users" ? (
              <TopUsersTable rows={analytics.topUsers} />
            ) : (
              <LoginHistoryTable
                rows={logins}
                loading={loginLoading}
                offset={loginOffset}
                hasMore={loginHasMore}
                onPage={loadLogins}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-[var(--border)] rounded-xl px-4 py-3 bg-[var(--bg-secondary)]">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
        {label}
      </div>
      <div className="text-xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-3 h-0.5"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function Tabs<K extends string>({
  active,
  onChange,
  tabs,
}: {
  active: K;
  onChange: (k: K) => void;
  tabs: { key: K; label: string }[];
}) {
  return (
    <div className="flex gap-1 border-b border-[var(--border)]">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              on
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]"
            }`}
            style={on ? { borderColor: "var(--accent)" } : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function TopUsersTable({ rows }: { rows: TopUser[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>User</Th>
          <Th>Messages</Th>
          <Th>Logins</Th>
          <Th>Last login</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <Td className="text-[var(--text-secondary)]">
              No messages in this range.
            </Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
          </tr>
        )}
        {rows.map((u) => (
          <tr key={u.userId ?? Math.random()}>
            <Td>
              {u.email ?? (
                <span className="text-[var(--text-secondary)]">
                  deleted user
                </span>
              )}
              {u.username && (
                <div className="text-xs text-[var(--text-secondary)]">
                  {u.username}
                </div>
              )}
            </Td>
            <Td>{u.n}</Td>
            <Td>{u.logins}</Td>
            <Td className="whitespace-nowrap text-[var(--text-secondary)]">
              {u.lastLoginAt
                ? new Date(u.lastLoginAt).toLocaleString()
                : "—"}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function LoginHistoryTable({
  rows,
  loading,
  offset,
  hasMore,
  onPage,
}: {
  rows: LoginEventRow[];
  loading: boolean;
  offset: number;
  hasMore: boolean;
  onPage: (off: number) => void;
}) {
  return (
    <div className="space-y-3">
      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>User</Th>
              <Th>Result</Th>
              <Th>IP</Th>
              <Th>User-Agent</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <Td className="text-[var(--text-secondary)]">No events.</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleString()}
                </Td>
                <Td>
                  {r.userEmail ?? (
                    <span className="text-[var(--text-secondary)]">
                      {r.emailAttempted}
                    </span>
                  )}
                  {r.username && (
                    <div className="text-xs text-[var(--text-secondary)]">
                      {r.username}
                    </div>
                  )}
                </Td>
                <Td>
                  {r.success ? (
                    <span className="text-emerald-300 text-xs">OK</span>
                  ) : (
                    <span className="text-red-400 text-xs">FAIL</span>
                  )}
                </Td>
                <Td className="text-xs text-[var(--text-secondary)]">
                  {r.ip || "—"}
                </Td>
                <Td
                  className="text-xs text-[var(--text-secondary)] max-w-[300px] truncate"
                  title={r.userAgent}
                >
                  {r.userAgent || "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--text-secondary)]">
          {rows.length === 0
            ? ""
            : `Showing ${offset + 1}–${offset + rows.length}`}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => onPage(Math.max(0, offset - LOGIN_PAGE))}
            disabled={offset === 0 || loading}
          >
            Newer
          </Button>
          <Button
            variant="ghost"
            onClick={() => onPage(offset + LOGIN_PAGE)}
            disabled={!hasMore || loading}
          >
            Older
          </Button>
        </div>
      </div>
    </div>
  );
}
