"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  PageHeader,
  Card,
  Stat,
  ErrorState,
  Loading,
  EmptyState,
} from "@/components/primitives";
import { useApi } from "@/lib/useApi";
import { money, qty, shortDate } from "@/lib/api";
import { useScope } from "@/lib/scope";
import { SeverityBadge, StatusBadge } from "@/components/status";
import { DataTable } from "@/components/DataTable";

/**
 * Pharmacy command centre (§24).
 *
 * One operational picture, ranked by severity rather than by module, because a
 * cold-chain excursion and a critical stockout compete for the same person's
 * next ten minutes. Every row states the recommended action and links to the
 * screen where it can be taken — a list of problems with no way to act on them
 * is a worry generator.
 */

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
const ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

interface Signal {
  id: string;
  severity: Severity;
  area: string;
  headline: string;
  detail: string;
  action: string;
  href: string;
  impact: number | null;
  when?: string | null;
}

export default function CommandCenterPage() {
  return (
    <Shell>
      <CommandCenterBody />
    </Shell>
  );
}

function CommandCenterBody() {
  const scope = useScope();
  const suffix = scope.branchId ? `?branchId=${scope.branchId}` : "";
  const { data, error, loading, refresh } = useApi<any>(
    `/analytics/command-center${suffix}`,
    [scope.branchId],
  );
  const [area, setArea] = useState("all");
  const [minSeverity, setMinSeverity] = useState<Severity | "all">("all");

  const signals = useMemo<Signal[]>(() => {
    if (!data) return [];
    const out: Signal[] = [];

    for (const s of data.criticalStockouts ?? []) {
      out.push({
        id: `stockout:${s.productId}`,
        severity: (s.severity ?? "CRITICAL") as Severity,
        area: "Stock",
        headline: s.product ?? s.name ?? "Product out of stock",
        detail: s.sku ? `${s.sku} — nothing on hand` : "Nothing on hand",
        action: s.recommendedAction ?? "Raise a purchase or transfer",
        href: "/procurement",
        impact: s.financialImpact ?? null,
      });
    }
    for (const e of data.expiryRisks ?? []) {
      out.push({
        id: `expiry:${e.batchId ?? e.batch}`,
        severity: (e.severity ??
          (e.daysRemaining <= 30 ? "HIGH" : "MEDIUM")) as Severity,
        area: "Expiry",
        headline: `${e.product ?? "Batch"} expires in ${e.daysRemaining} days`,
        detail: `Batch ${e.batch ?? "—"} · ${qty(e.quantity)} units`,
        action:
          e.recommendedAction ??
          "Transfer, return or discount before it expires",
        href: "/inventory/expiry",
        impact: e.financialImpact ?? e.valueAtRisk ?? null,
      });
    }
    for (const c of data.coldChainAlerts ?? []) {
      out.push({
        id: `cold:${c.excursionId ?? c.sensor}`,
        severity: (c.severity ?? "HIGH") as Severity,
        area: "Cold chain",
        headline: `Temperature excursion on ${c.sensor ?? "a sensor"}`,
        detail: c.detail ?? `${c.durationMinutes ?? 0} minutes outside range`,
        action:
          c.recommendedAction ?? "QA must decide: release, reject or destroy",
        href: "/cold-chain",
        impact: c.financialImpact ?? null,
      });
    }
    for (const r of data.recalls ?? []) {
      out.push({
        id: `recall:${r.recallId ?? r.recallNo}`,
        severity: "CRITICAL",
        area: "Recall",
        headline: `Recall ${r.recallNo ?? ""} is open`,
        detail: `${r.pendingTasks ?? 0} outstanding task(s) across ${r.affectedBatches ?? 0} batch(es)`,
        action: r.recommendedAction ?? "Complete the outstanding recall tasks",
        href: "/recalls",
        impact: r.financialImpact ?? null,
      });
    }
    for (const q of data.quarantinedInventory ?? []) {
      out.push({
        id: `quarantine:${q.batchId}`,
        severity: (q.severity ?? "MEDIUM") as Severity,
        area: "Quality",
        headline: `${q.product} is quarantined`,
        detail: `Batch ${q.batch} · ${qty(q.quantity)} units · ${q.reason ?? "no reason recorded"}`,
        action: q.recommendedAction ?? "QA review: release, return or dispose",
        href: "/batches",
        impact: q.financialImpact ?? null,
      });
    }
    for (const a of data.pendingApprovals ?? []) {
      out.push({
        id: `approval:${a.documentId}`,
        severity: (a.severity ?? "MEDIUM") as Severity,
        area: "Approvals",
        headline: `${(a.documentType ?? "").replace(/_/g, " ").toLowerCase()} ${a.reference} is waiting`,
        detail: `${a.waitingDays ?? 0} day(s) waiting · ${a.status}`,
        action: a.recommendedAction ?? "Review and approve or reject",
        href: "/approvals",
        impact: a.financialImpact ?? null,
      });
    }
    for (const d of data.supplierDelays ?? []) {
      out.push({
        id: `delay:${d.poNo}`,
        severity: (d.severity ?? "MEDIUM") as Severity,
        area: "Supply",
        headline: `${d.poNo} from ${d.supplier} is late`,
        detail: `${d.daysLate ?? 0} day(s) past the expected date`,
        action:
          d.recommendedAction ??
          "Chase the supplier and update the expected date",
        href: "/procurement",
        impact: d.financialImpact ?? null,
        when: d.expectedDate,
      });
    }

    return out.sort(
      (a, b) =>
        ORDER[a.severity] - ORDER[b.severity] ||
        (b.impact ?? 0) - (a.impact ?? 0),
    );
  }, [data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    for (const s of signals) c[s.severity] = (c[s.severity] ?? 0) + 1;
    return c;
  }, [signals]);

  const areas = useMemo(
    () => ["all", ...new Set(signals.map((s) => s.area))],
    [signals],
  );

  const shown = signals.filter(
    (s) =>
      (area === "all" || s.area === area) &&
      (minSeverity === "all" || ORDER[s.severity] <= ORDER[minSeverity]),
  );

  const exposure = shown.reduce((sum, s) => sum + (s.impact ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Command centre"
        subtitle="Everything that needs a decision today, ranked by severity rather than by module. Each row says what to do and takes you there."
        action={
          <button className="btn-ghost btn-sm" onClick={refresh}>
            Refresh
          </button>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}
      {loading && !data && <Loading label="Reading the operation" />}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="Critical"
              value={counts.CRITICAL}
              tone={counts.CRITICAL ? "danger" : "neutral"}
              sub="Act now"
              onClick={() => setMinSeverity("CRITICAL")}
            />
            <Stat
              label="High"
              value={counts.HIGH}
              tone={counts.HIGH ? "warn" : "neutral"}
              sub="Act today"
              onClick={() => setMinSeverity("HIGH")}
            />
            <Stat
              label="Medium"
              value={counts.MEDIUM}
              sub="This week"
              onClick={() => setMinSeverity("MEDIUM")}
            />
            <Stat
              label="Signals shown"
              value={shown.length}
              sub={
                shown.length === signals.length
                  ? "No filter"
                  : `of ${signals.length}`
              }
            />
            <Stat
              label="Value exposed"
              value={money(exposure)}
              tone={exposure > 0 ? "warn" : "neutral"}
              sub="Across the signals shown"
            />
          </div>

          <Card
            title="Operational signals"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input w-auto py-1 text-small"
                  value={minSeverity}
                  aria-label="Minimum severity"
                  onChange={(e) =>
                    setMinSeverity(e.target.value as Severity | "all")
                  }
                >
                  <option value="all">Every severity</option>
                  <option value="CRITICAL">Critical only</option>
                  <option value="HIGH">High and above</option>
                  <option value="MEDIUM">Medium and above</option>
                </select>
                <select
                  className="input w-auto py-1 text-small"
                  value={area}
                  aria-label="Area"
                  onChange={(e) => setArea(e.target.value)}
                >
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a === "all" ? "Every area" : a}
                    </option>
                  ))}
                </select>
              </div>
            }
            padded={false}
          >
            <div className="p-4">
              {shown.length === 0 ? (
                <EmptyState
                  title={
                    signals.length === 0
                      ? "Nothing needs a decision right now"
                      : "Nothing matches this filter"
                  }
                  body={
                    signals.length === 0
                      ? "Stockouts, expiry risk, cold-chain excursions, open recalls, quarantined stock, waiting approvals and late deliveries all appear here as they arise."
                      : "Widen the severity or area filter to see the rest."
                  }
                />
              ) : (
                <DataTable
                  rows={shown}
                  getKey={(s) => s.id}
                  pageSize={25}
                  exportName="command-centre"
                  searchPlaceholder="Search signals"
                  viewKey="command-centre"
                  rowTone={(s) =>
                    s.severity === "CRITICAL"
                      ? "danger"
                      : s.severity === "HIGH"
                        ? "warn"
                        : null
                  }
                  columns={[
                    {
                      key: "severity",
                      label: "Severity",
                      width: "7rem",
                      value: (s) => ORDER[s.severity],
                      render: (s) => <SeverityBadge level={s.severity} />,
                    },
                    {
                      key: "area",
                      label: "Area",
                      width: "7rem",
                      value: (s) => s.area,
                    },
                    {
                      key: "headline",
                      label: "What is happening",
                      value: (s) => s.headline,
                      render: (s) => (
                        <div>
                          <div className="font-medium text-ink">
                            {s.headline}
                          </div>
                          <div className="text-small text-ink-muted">
                            {s.detail}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "action",
                      label: "Recommended action",
                      value: (s) => s.action,
                    },
                    {
                      key: "impact",
                      label: "Value",
                      numeric: true,
                      align: "right",
                      value: (s) => s.impact ?? 0,
                      render: (s) =>
                        s.impact ? (
                          money(s.impact)
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        ),
                    },
                    {
                      key: "go",
                      label: "",
                      action: true,
                      render: (s) => (
                        <Link href={s.href} className="btn-ghost btn-sm">
                          Open
                        </Link>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
