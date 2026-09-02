"use client";

import Link from "next/link";
import { useApi } from "@/lib/useApi";
import { Card, ErrorState, Loading } from "@/components/primitives";
import { StatusBadge, StatusTone } from "@/components/status";

const BAND_TONE: Record<string, StatusTone> = {
  EXCELLENT: "available",
  GOOD: "available",
  ATTENTION_REQUIRED: "near",
  HIGH_RISK: "expired",
  CRITICAL: "out",
};

function scoreColour(score: number) {
  return score >= 75 ? "text-ok" : score >= 60 ? "text-warn" : "text-danger";
}
function barColour(score: number) {
  return score >= 75 ? "bg-ok" : score >= 60 ? "bg-warn" : "bg-danger";
}

/**
 * Inventory health as one number, with the reasoning attached (§11).
 *
 * The number alone is close to useless, so every factor shows the measurement
 * behind it and what would improve it. A factor with nothing to measure is
 * named rather than scored zero: a pharmacy that has never run a count should
 * not be told its accuracy is nil.
 */
export function HealthScoreCard({ branchId }: { branchId?: string | null }) {
  const { data, error, loading, refresh } = useApi<any>(
    `/analytics/health-score${branchId ? `?branchId=${branchId}` : ""}`,
    [branchId],
  );

  if (loading) return <Loading label="Scoring inventory health" />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  return (
    <Card
      title="Inventory health"
      action={
        <span className="text-caption text-ink-subtle">
          {new Date(data.computedAt).toLocaleString()}
        </span>
      }
    >
      <div className="flex flex-wrap items-start gap-6">
        <div className="shrink-0">
          <div className={`num text-display ${scoreColour(data.score)}`}>
            {data.score}
          </div>
          <div className="text-caption text-ink-subtle">out of 100</div>
          <div className="mt-1">
            <StatusBadge tone={BAND_TONE[data.band] ?? "neutral"}>
              {data.band.replace(/_/g, " ")}
            </StatusBadge>
          </div>
        </div>

        <div className="min-w-[16rem] flex-1">
          <p className="text-body text-ink-muted">{data.summary}</p>
          {data.unmeasured.length > 0 && (
            <p className="mt-1 text-small text-ink-subtle">
              Not measured, and left out of the average:{" "}
              {data.unmeasured.join(", ")}.
            </p>
          )}
          {data.priorityActions.length > 0 && (
            <ul className="mt-3 space-y-1">
              {data.priorityActions.map((a: any) => (
                <li key={a.factor} className="text-small text-ink-muted">
                  <Link
                    className="font-medium text-brand-dark underline"
                    href={a.linkUrl}
                  >
                    {a.factor}
                  </Link>{" "}
                  — {a.action}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-border pt-3">
        {data.factors.map((f: any) => (
          <div
            key={f.key}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small"
          >
            <Link
              href={f.linkUrl}
              className="w-44 shrink-0 truncate text-ink-muted hover:text-ink hover:underline"
            >
              {f.label}
            </Link>
            <span className="h-2.5 min-w-[6rem] flex-1 overflow-hidden rounded-pill bg-surface-sunken">
              {f.score >= 0 && (
                <span
                  className={`block h-full rounded-pill ${barColour(f.score)}`}
                  style={{ width: `${Math.max(2, f.score)}%` }}
                />
              )}
            </span>
            <span className="w-16 shrink-0 text-right num text-ink">
              {f.score >= 0 ? `${f.score}/100` : "n/a"}
            </span>
            <span
              className="w-full text-caption text-ink-subtle sm:w-auto sm:flex-[2] sm:truncate"
              title={f.measurement}
            >
              {f.measurement}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
