"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorBanner } from "@/components/admin/ui";
import { t } from "@/lib/i18n";
import ConfirmModal from "./ConfirmModal";

interface BackendStats {
  document_count?: number;
  chunk_count?: number;
  entity_count?: number;
  relationship_count?: number;
  community_count?: number;
  pending_task_count?: number;
  [k: string]: unknown;
}

interface StepInfo {
  status?: string;
  progress?: number;
  [k: string]: unknown;
}

interface BackendGraphStatus {
  entity_count?: number;
  within_document_relationship_count?: number;
  cross_document_relationship_count?: number;
  relationship_count?: number;
  community_count?: number;
  steps?: {
    entity_extraction?: StepInfo;
    relationship_analysis?: StepInfo;
    community_detection?: StepInfo;
    [k: string]: StepInfo | undefined;
  };
  [k: string]: unknown;
}

interface BackendTask {
  id: string;
  status?: string;
  kind?: string;
  type?: string;
  progress?: number;
  message?: string;
  error?: string;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

function Kpi({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | string | undefined;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border px-4 py-3"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div
        className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--fg2)" }}
      >
        {label}
      </div>
      <div
        className="text-[22px] font-bold"
        style={{
          color: accent ? "var(--accent)" : "var(--fg1)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function StepCard({
  title,
  description,
  step,
  children,
}: {
  title: string;
  description: string;
  step?: StepInfo;
  children: React.ReactNode;
}) {
  const status = step?.status;
  const running =
    status === "running" ||
    status === "processing" ||
    status === "in_progress";
  return (
    <div
      className="rounded-[var(--radius-lg)] border p-5 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className="text-[14px] font-semibold"
            style={{ color: "var(--fg1)" }}
          >
            {title}
          </div>
          <div className="text-[12.5px] mt-1" style={{ color: "var(--fg2)" }}>
            {description}
          </div>
        </div>
        {status && (
          <span
            className="text-[10.5px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-[var(--radius-sm)]"
            style={{
              background: "var(--muted)",
              color: running ? "var(--accent)" : "var(--fg2)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {status}
          </span>
        )}
      </div>
      {typeof step?.progress === "number" && (
        <div
          className="h-1.5 w-full rounded-full overflow-hidden"
          style={{ background: "var(--muted)" }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, step.progress))}%`,
              background: "var(--accent)",
              height: "100%",
              transition: "width 300ms ease-out",
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">{children}</div>
    </div>
  );
}

export default function ProcessingTab() {
  const [stats, setStats] = useState<BackendStats | null>(null);
  const [graph, setGraph] = useState<BackendGraphStatus | null>(null);
  const [tasks, setTasks] = useState<BackendTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, g, r] = await Promise.all([
        fetch("/api/admin/library/stats").then((x) => x.json()),
        fetch("/api/admin/library/graph/status").then((x) => x.json()),
        fetch("/api/admin/library/tasks?status=running&limit=20").then((x) =>
          x.json()
        ),
      ]);
      if (s.error) throw new Error(s.error);
      if (g.error) throw new Error(g.error);
      if (r.error) throw new Error(r.error);
      setStats(s);
      setGraph(g);
      setTasks(r.tasks ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while there is running work OR tab is visible. Pauses when hidden.
  const pollingRef = useRef<number | null>(null);
  useEffect(() => {
    const shouldPoll =
      tasks.length > 0 ||
      (stats?.pending_task_count ?? 0) > 0 ||
      Object.values(graph?.steps ?? {}).some(
        (s) =>
          s?.status === "running" ||
          s?.status === "processing" ||
          s?.status === "in_progress"
      );

    if (!shouldPoll) {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (pollingRef.current) return;

    pollingRef.current = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 3000);
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [tasks.length, stats?.pending_task_count, graph?.steps, load]);

  async function run(
    path: string,
    busyKey: string,
    body?: unknown,
    successToast?: string
  ) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("failedToLoad"));
      setToast(successToast ?? t("taskStarted"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-[13px] max-w-3xl" style={{ color: "var(--fg2)" }}>
        {t("processingDescription")}
      </p>

      <ErrorBanner message={error} />
      {toast && (
        <div
          className="text-[12px] rounded-[var(--radius)] px-3 py-2 border"
          style={{
            background: "color-mix(in oklch, var(--success) 14%, transparent)",
            borderColor:
              "color-mix(in oklch, var(--success) 32%, transparent)",
            color: "var(--success)",
          }}
        >
          {toast}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Kpi label={t("kpiDocuments")} value={stats?.document_count} />
        <Kpi label={t("kpiChunks")} value={stats?.chunk_count} />
        <Kpi label={t("kpiEntities")} value={stats?.entity_count} />
        <Kpi
          label={t("kpiRelationships")}
          value={stats?.relationship_count}
        />
        <Kpi label={t("kpiCommunities")} value={stats?.community_count} />
        <Kpi
          label={t("kpiPendingTasks")}
          value={stats?.pending_task_count}
          accent={(stats?.pending_task_count ?? 0) > 0}
        />
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <StepCard
          title={t("stepExtractionTitle")}
          description={t("stepExtractionDescription")}
          step={graph?.steps?.entity_extraction}
        >
          <Button
            onClick={() =>
              run(
                "/api/admin/library/documents/process-pending",
                "pending",
                undefined,
                t("pendingQueued")
              )
            }
            disabled={busy === "pending"}
          >
            {busy === "pending" ? t("processingPending") : t("processPending")}
          </Button>
        </StepCard>

        <StepCard
          title={t("stepRelationshipsTitle")}
          description={t("stepRelationshipsDescription")}
          step={graph?.steps?.relationship_analysis}
        >
          <Button
            onClick={() =>
              run(
                "/api/admin/library/graph/relationships/analyze",
                "analyze",
                {}
              )
            }
            disabled={busy === "analyze"}
          >
            {busy === "analyze" ? t("runningAnalyze") : t("runAnalyze")}
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirmRebuild(true)}
            disabled={busy === "rebuild"}
          >
            {busy === "rebuild" ? t("runningAnalyze") : t("runRebuild")}
          </Button>
        </StepCard>

        <StepCard
          title={t("stepCommunitiesTitle")}
          description={t("stepCommunitiesDescription")}
          step={graph?.steps?.community_detection}
        >
          <Button
            onClick={() =>
              run("/api/admin/library/graph/communities/detect", "detect", {})
            }
            disabled={busy === "detect"}
          >
            {busy === "detect" ? t("detecting") : t("runDetect")}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              run(
                "/api/admin/library/graph/communities/summarize",
                "summarize"
              )
            }
            disabled={busy === "summarize"}
          >
            {busy === "summarize" ? t("summarizing") : t("runSummarize")}
          </Button>
        </StepCard>
      </div>

      <div
        className="rounded-[var(--radius-lg)] border p-5 space-y-3"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <div
            className="text-[14px] font-semibold"
            style={{ color: "var(--fg1)" }}
          >
            {t("runningTasks")}
          </div>
          <Button
            variant="outline"
            onClick={() => setConfirmCleanup(true)}
            disabled={busy === "cleanup"}
          >
            {busy === "cleanup" ? t("deleting") : t("cleanupOrphaned")}
          </Button>
        </div>
        {tasks.length === 0 ? (
          <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
            {t("noRunningTasks")}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between py-2 gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[13px] truncate"
                    style={{ color: "var(--fg1)" }}
                  >
                    {task.kind || task.type || task.id}
                  </div>
                  <div
                    className="text-[11px] truncate"
                    style={{
                      color: "var(--fg2)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {task.id}
                    {task.message ? ` · ${task.message}` : ""}
                  </div>
                </div>
                {typeof task.progress === "number" && (
                  <div className="w-40 shrink-0">
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--muted)" }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, task.progress))}%`,
                          background: "var(--accent)",
                          height: "100%",
                          transition: "width 300ms ease-out",
                        }}
                      />
                    </div>
                    <div
                      className="text-[10.5px] mt-1 text-right"
                      style={{
                        color: "var(--fg2)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {Math.round(task.progress)}%
                    </div>
                  </div>
                )}
                <span
                  className="text-[10.5px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-[var(--radius-sm)]"
                  style={{
                    background: "var(--muted)",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {task.status || "running"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmRebuild}
        title={t("rebuildConfirmTitle")}
        body={t("rebuildConfirmBody")}
        confirmLabel={t("rebuild")}
        confirmVariant="danger"
        onClose={() => setConfirmRebuild(false)}
        onConfirm={async () => {
          setConfirmRebuild(false);
          await run(
            "/api/admin/library/graph/relationships/analyze",
            "rebuild",
            { rebuild: true }
          );
        }}
      />

      <ConfirmModal
        open={confirmCleanup}
        title={t("cleanupConfirmTitle")}
        body={t("cleanupConfirmBody")}
        confirmLabel={t("cleanupOrphaned")}
        confirmVariant="primary"
        onClose={() => setConfirmCleanup(false)}
        onConfirm={async () => {
          setConfirmCleanup(false);
          await run(
            "/api/admin/library/graph/cleanup",
            "cleanup",
            undefined,
            t("cleanupQueued")
          );
        }}
      />
    </div>
  );
}
