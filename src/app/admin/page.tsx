"use client";

import { useEffect, useState } from "react";

interface Kpi {
  label: string;
  value: number | string;
  hint?: string;
}

export default function AdminDashboard() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/users").then((r) => r.json()),
      fetch("/api/admin/groups").then((r) => r.json()),
    ])
      .then(([u, g]) => {
        const users = u.users ?? [];
        const groups = g.groups ?? [];
        const uploaders = users.filter(
          (x: { contentKeyId: string | null }) => x.contentKeyId
        ).length;
        setKpis([
          { label: "Users", value: users.length },
          { label: "Groups", value: groups.length },
          {
            label: "Uploaders",
            value: uploaders,
            hint: "Users with a content-role key",
          },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Quick snapshot of the chat suite. Use the navigation to manage users,
          groups, content roles, and view analytics.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="border border-[var(--border)] rounded-xl px-5 py-4 bg-[var(--bg-secondary)]"
            >
              <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                {k.label}
              </div>
              <div className="text-2xl font-semibold mt-1">{k.value}</div>
              {k.hint && (
                <div className="text-xs text-[var(--text-secondary)] mt-1">
                  {k.hint}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
