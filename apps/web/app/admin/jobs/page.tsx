"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api } from "@/lib/api";
import { Card, ErrorBox, Loading, Pill, Stat } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { useFeedback } from "@/components/Feedback";

interface JobRow {
  key: string;
  label: string;
  description: string;
  schedule: string;
  isRunning: boolean;
  lastStatus: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastResult: unknown;
}

interface HealthCheck {
  key: string;
  label: string;
  state: "OK" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED";
  detail: string;
  latencyMs?: number;
  linkUrl?: string;
}

const STATE_TONE = {
  OK: "ok",
  DEGRADED: "warn",
  DOWN: "danger",
  NOT_CONFIGURED: "neutral",
} as const;

const JOB_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  SUCCESS: "ok",
  FAILED: "danger",
  SKIPPED: "warn",
  NEVER_RUN: "neutral",
};

function when(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function duration(ms: number | null) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export default function JobsPage() {
  const { toast, confirm } = useFeedback();
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const health = useApi<{
    state: string;
    uptimeSeconds: number;
    checks: HealthCheck[];
    cache: any;
    failedJobs: any[];
  }>("/admin/health", [version]);
  const jobs = useApi<JobRow[]>("/admin/jobs", [version]);
  // Run history grows every hour of every day. It used to hand the table the
  // most recent 50 and let its pager walk them, which reads like the whole of
  // the record.
  const history = usePaged<any>("/admin/jobs/history", {
    filters: [
      selected ? `jobKey=${encodeURIComponent(selected)}` : "",
      version ? `v=${version}` : "",
    ]
      .filter(Boolean)
      .join("&"),
    pageSize: 25,
  });

  async function run(job: JobRow) {
    const { confirmed } = await confirm({
      title: `Run ${job.label} now?`,
      body: `${job.description} It normally runs on the schedule "${job.schedule}". Running it by hand does the same real work — it is not a simulation.`,
      confirmLabel: "Run now",
    });
    if (!confirmed) return;

    setBusy(job.key);
    setError(null);
    try {
      const result = await api<{ status: string; error?: string }>(
        `/admin/jobs/${encodeURIComponent(job.key)}/run`,
        { method: "POST" },
      );
      // A job that failed reports the failure rather than a cheerful toast.
      if (result.status === "FAILED") {
        setError(
          `${job.label} failed: ${result.error ?? "no reason recorded"}`,
        );
      } else {
        toast(
          `${job.label}: ${result.status.toLowerCase()}`,
          result.status === "SUCCESS" ? "ok" : "info",
        );
      }
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const checks = health.data?.checks ?? [];
  const failing = checks.filter(
    (c) => c.state === "DOWN" || c.state === "DEGRADED",
  );
  const unconfigured = checks.filter((c) => c.state === "NOT_CONFIGURED");

  return (
    <Shell>
      <PageHeader
        title="System health and background jobs"
        subtitle="Every check below performs real work — a query, a disk stat, a read of the delivery queue. Nothing reports healthy because a variable is set."
        action={
          <button
            className="btn-ghost"
            onClick={() => setVersion((v) => v + 1)}
          >
            Refresh
          </button>
        }
      />

      {error && <ErrorBox message={error} />}
      {health.error && <ErrorBox message={health.error} />}
      {health.loading && !health.data && (
        <Loading label="Checking dependencies" />
      )}

      {health.data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Overall"
              value={health.data.state}
              tone={
                health.data.state === "OK"
                  ? "neutral"
                  : health.data.state === "DEGRADED"
                    ? "warn"
                    : "danger"
              }
            />
            <Stat
              label="Uptime"
              value={`${Math.round(health.data.uptimeSeconds / 60)} min`}
            />
            <Stat
              label="Needs attention"
              value={failing.length}
              tone={failing.length ? "warn" : "neutral"}
              sub={
                failing.length
                  ? failing.map((c) => c.label).join(", ")
                  : "All dependencies responding"
              }
            />
            <Stat
              label="Not configured"
              value={unconfigured.length}
              sub="Deployment choices, not outages"
            />
          </div>

          <Card title="Dependency checks">
            <div className="grid gap-2 md:grid-cols-2">
              {checks.map((check) => (
                <div
                  key={check.key}
                  className="min-w-0 rounded-md border border-surface-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-medium text-ink">
                      {check.label}
                    </span>
                    <Pill tone={STATE_TONE[check.state]}>
                      {check.state.replace("_", " ")}
                    </Pill>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{check.detail}</p>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-subtle">
                    {check.latencyMs !== undefined && (
                      <span>{check.latencyMs} ms</span>
                    )}
                    {check.linkUrl && (
                      <a
                        className="text-brand-dark underline"
                        href={check.linkUrl}
                      >
                        Go there
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {health.data.cache && (
            <Card title="Cache">
              <div className="flex flex-wrap gap-4 text-sm text-ink-muted">
                {Object.entries(health.data.cache).map(([key, value]) => (
                  <span key={key}>
                    <span className="text-ink-subtle">{key}:</span>{" "}
                    <span className="num text-ink">{String(value)}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="mt-5 space-y-5">
        <Card title="Registered jobs">
          {jobs.error && <ErrorBox message={jobs.error} />}
          {jobs.loading && !jobs.data && <Loading />}
          {jobs.data && (
            <DataTable
              rows={jobs.data}
              getKey={(j) => j.key}
              exportName="background-jobs"
              searchPlaceholder="Search jobs"
              selectedKey={selected}
              onRowClick={(j) =>
                setSelected((s) => (s === j.key ? null : j.key))
              }
              columns={[
                {
                  key: "label",
                  label: "Job",
                  value: (j) => j.label,
                  render: (j) => (
                    <div>
                      <div className="font-medium text-ink">{j.label}</div>
                      <div className="text-xs text-ink-subtle">
                        {j.description}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "schedule",
                  label: "Schedule",
                  value: (j) => j.schedule,
                },
                {
                  key: "status",
                  label: "Last run",
                  value: (j) => j.lastStatus,
                  render: (j) => (
                    <div className="flex items-center gap-2">
                      <Pill tone={JOB_TONE[j.lastStatus] ?? "neutral"}>
                        {j.lastStatus.replace("_", " ")}
                      </Pill>
                      {j.isRunning && <Pill tone="info">Running</Pill>}
                    </div>
                  ),
                },
                {
                  key: "started",
                  label: "Started",
                  value: (j) => j.lastStartedAt ?? "",
                  render: (j) => when(j.lastStartedAt),
                },
                {
                  key: "duration",
                  label: "Took",
                  numeric: true,
                  align: "right",
                  value: (j) => j.lastDurationMs ?? 0,
                  render: (j) => duration(j.lastDurationMs),
                },
                {
                  key: "error",
                  label: "Failure",
                  optional: true,
                  value: (j) => j.lastError ?? "",
                  render: (j) => (
                    <span className="text-danger">{j.lastError ?? "—"}</span>
                  ),
                },
                {
                  key: "run",
                  label: "",
                  render: (j) => (
                    <button
                      className="btn-ghost"
                      disabled={busy === j.key || j.isRunning}
                      onClick={(e) => {
                        e.stopPropagation();
                        void run(j);
                      }}
                    >
                      {busy === j.key ? "Running…" : "Run now"}
                    </button>
                  ),
                },
              ]}
            />
          )}
        </Card>

        <Card
          title={
            selected ? `Run history — ${selected}` : "Run history (all jobs)"
          }
          action={
            selected && (
              <button className="btn-ghost" onClick={() => setSelected(null)}>
                Show all
              </button>
            )
          }
        >
          {history.error && <ErrorBox message={history.error} />}
          {!history.error && (
            <DataTable
              rows={history.rows}
              server={history.server}
              getKey={(r: any) => r.id}
              empty="This job has not run yet."
              exportName="job-history"
              columns={[
                { key: "jobKey", label: "Job", value: (r: any) => r.jobKey },
                {
                  key: "status",
                  label: "Status",
                  value: (r: any) => r.status,
                  render: (r: any) => (
                    <Pill tone={JOB_TONE[r.status] ?? "neutral"}>
                      {r.status}
                    </Pill>
                  ),
                },
                {
                  key: "trigger",
                  label: "Trigger",
                  value: (r: any) => r.trigger ?? "",
                },
                {
                  key: "startedAt",
                  label: "Started",
                  value: (r: any) => r.startedAt,
                  render: (r: any) => when(r.startedAt),
                },
                {
                  key: "durationMs",
                  label: "Took",
                  numeric: true,
                  align: "right",
                  value: (r: any) => r.durationMs ?? 0,
                  render: (r: any) => duration(r.durationMs),
                },
                {
                  key: "result",
                  label: "Outcome",
                  value: (r: any) =>
                    r.errorMessage
                      ? r.errorMessage
                      : r.result
                        ? JSON.stringify(r.result)
                        : "",
                  render: (r: any) =>
                    r.errorMessage ? (
                      <span className="text-danger">{r.errorMessage}</span>
                    ) : (
                      <span className="text-xs text-ink-subtle">
                        {r.result ? JSON.stringify(r.result) : "—"}
                      </span>
                    ),
                },
              ]}
            />
          )}
        </Card>
      </div>
    </Shell>
  );
}
