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
import { ErrorBanner, Select, Table, Td, Th } from "@/components/admin/ui";

interface SeriesPoint {
  day: string;
  logins: number;
  messages: number;
  uploads: number;
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
  topUsers: {
    userId: string | null;
    email: string | null;
    username: string | null;
    n: number;
  }[];
}

const RANGES = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics?days=${d}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Aggregated activity from logins, messages, and uploads. Per-user
            message count shows the top 10 users in the selected range.
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

      {loading || !data ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Logins" value={data.totals.logins} />
            <Kpi label="Messages" value={data.totals.messages} />
            <Kpi label="Uploads" value={data.totals.uploads} />
            <Kpi label="Active users" value={data.totals.activeUsers} />
          </div>

          <section className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
            <div className="text-sm font-medium mb-3">Daily activity</div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series}>
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
            <div className="text-sm font-medium">Top users by messages</div>
            <Table>
              <thead>
                <tr>
                  <Th>User</Th>
                  <Th>Messages</Th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.length === 0 && (
                  <tr>
                    <Td className="text-[var(--text-secondary)]">
                      No messages in this range.
                    </Td>
                    <Td>{""}</Td>
                  </tr>
                )}
                {data.topUsers.map((u) => (
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
                  </tr>
                ))}
              </tbody>
            </Table>
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
