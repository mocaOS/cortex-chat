"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorBanner, Table, Td, Th } from "@/components/admin/ui";

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

const PAGE = 50;

export default function AdminLoginsPage() {
  const [rows, setRows] = useState<LoginEventRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (off: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/login-events?limit=${PAGE}&offset=${off}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setRows(data.events);
      setHasMore(data.events.length === PAGE);
      setOffset(off);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Login history</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          All login attempts — successful and failed — with IP and
          user-agent.
        </p>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <>
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
                  <Td className="text-[var(--text-secondary)]">
                    No events.
                  </Td>
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

          <div className="flex items-center justify-between">
            <div className="text-xs text-[var(--text-secondary)]">
              Showing {offset + 1}–{offset + rows.length}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => load(Math.max(0, offset - PAGE))}
                disabled={offset === 0}
              >
                Newer
              </Button>
              <Button
                variant="ghost"
                onClick={() => load(offset + PAGE)}
                disabled={!hasMore}
              >
                Older
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
