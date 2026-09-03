"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, qty, shortDate } from "@/lib/api";
import { useFeedback } from "@/components/Feedback";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  MoreMatches,
  Pager,
  Pill,
  Table,
} from "@/components/ui";
import { usePaged } from "@/lib/paged";
import {
  Card as Panel,
  EmptyState,
  ErrorState,
  Stat,
} from "@/components/primitives";
import { DataTable } from "@/components/DataTable";
import { SeverityBadge } from "@/components/status";

/**
 * Controlled medicines register (§28).
 *
 * Append-only with a running balance. Nothing here can be edited or deleted —
 * a correction appends a REVERSAL entry pointing at the one it cancels, which
 * is what lets the register be reconciled against physical stock.
 */
export default function ControlledPage() {
  const { prompt } = useFeedback();
  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

    // The reader's own branches and warehouses. Not `/admin/organization`, which
  // requires admin.branch.READ and therefore fails for every operational role.
  const org = useApi<any>("/auth/me/scope");
  // Controlled medicines are a small, closed set of the drug master; 200 is
  // the ceiling the endpoint allows and comfortably above any real register.
  const products = useApi<any>("/products?isControlled=true&pageSize=200");
  // The register a regulator reads. It used to stop at 200 entries with no
  // total and no route to the rest, which for a statutory record is the
  // difference between a complete register and a partial one.
  const register = usePaged<any>("/controlled-register", {
    filters: [
      productId ? `productId=${productId}` : "",
      branchId ? `branchId=${branchId}` : "",
      message ? `v=${encodeURIComponent(message)}` : "",
    ]
      .filter(Boolean)
      .join("&"),
    pageSize: 50,
  });
  const reconciliation = useApi<any>(
    productId && branchId
      ? `/controlled-register/reconcile?productId=${productId}&branchId=${branchId}`
      : null,
    [productId, branchId, message],
  );

  async function reverse(entryId: string) {
    const answer = await prompt({
      title: "Reverse this register entry?",
      body: "A reversal is appended to the register; the original entry is never edited or deleted. Both rows stay visible to a regulator, and this reason is one of them.",
      confirmLabel: "Append a reversal",
      tone: "danger",
      fields: [
        {
          name: "reason",
          label: "Why the entry is being reversed",
          type: "textarea",
          required: true,
          validate: (v: string) =>
            v.length < 10
              ? "A statutory register needs a reason someone can act on."
              : null,
        },
      ],
    });
    if (!answer) return;
    const reason = answer.reason;
    setBusy(true);
    setError(null);
    try {
      await api(`/controlled-register/${entryId}/reverse`, {
        method: "POST",
        body: { reason },
      });
      setMessage("Reversal entry appended.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Controlled Medicines Register"
        subtitle="Statutory register. Append-only: corrections are reversal entries, never edits or deletions."
        action={
          <a
            className="btn-ghost"
            target="_blank"
            rel="noreferrer"
            href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/reports/run/controlled-register?format=print${productId ? `&productId=${productId}` : ""}`}
          >
            Print register
          </a>
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}
      {message && (
        <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">
          {message}
        </div>
      )}

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Controlled medicine</label>
            <select
              aria-label="Controlled medicine"
              className="input"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">All controlled medicines</option>
              {(products.data?.data ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.genericName} {p.strength}
                </option>
              ))}
            </select>
            <MoreMatches
              shown={(products.data?.data ?? []).length}
              total={products.data?.total}
            />
          </div>
          <div>
            <label className="label">Branch</label>
            <select
              aria-label="Branch"
              className="input"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All branches</option>
              {(org.data?.branches ?? []).map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(!productId || !branchId) && (
          <p className="mt-2 text-xs text-ink-subtle">
            Choose both a medicine and a branch to reconcile the register
            against physical stock.
          </p>
        )}
      </Card>

      {reconciliation.data && (
        <Card
          className="mb-4"
          title="Reconciliation"
          action={
            <Pill tone={reconciliation.data.reconciled ? "ok" : "danger"}>
              {reconciliation.data.reconciled
                ? "balanced"
                : "VARIANCE — investigate"}
            </Pill>
          }
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md bg-surface-sunken p-3">
              <div className="text-xs text-ink-muted">Register balance</div>
              <div className="text-lg font-semibold num">
                {qty(reconciliation.data.registerBalance)}
              </div>
            </div>
            <div className="rounded-md bg-surface-sunken p-3">
              <div className="text-xs text-ink-muted">Physical stock</div>
              <div className="text-lg font-semibold num">
                {qty(reconciliation.data.physicalBalance)}
              </div>
            </div>
            <div
              className={`rounded-md p-3 ${reconciliation.data.reconciled ? "bg-surface-sunken" : "bg-danger-light"}`}
            >
              <div className="text-xs text-ink-muted">Variance</div>
              <div
                className={`text-lg font-semibold num ${reconciliation.data.reconciled ? "" : "text-danger"}`}
              >
                {qty(reconciliation.data.variance)}
              </div>
            </div>
          </div>
          {reconciliation.data.requiresInvestigation && (
            <p className="mt-3 text-sm text-danger">
              The register and the shelf disagree. This must be investigated and
              explained — the system will not adjust either side on its own.
            </p>
          )}
        </Card>
      )}

      <Card
        title={`${register.total.toLocaleString()} register ${register.total === 1 ? "entry" : "entries"}`}
      >
        {register.loading && <Loading />}
        {register.error && <ErrorBox message={register.error} />}
        {register.rows.length ? (
          <Table
            head={[
              "Entry",
              "Date",
              "Type",
              "Received",
              "Issued",
              "Balance",
              "Prescriber",
              "Reversal",
              "",
            ]}
          >
            {register.rows.map((e: any) => (
              <tr
                key={e.id}
                className={e.entryType === "REVERSAL" ? "bg-warn-light" : ""}
              >
                <td className="td num font-medium">{e.entryNo}</td>
                <td className="td text-xs text-ink-muted">
                  {shortDate(e.occurredAt)}
                </td>
                <td className="td">
                  <Pill
                    tone={
                      e.entryType === "REVERSAL"
                        ? "warn"
                        : e.entryType === "DISPENSE"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {e.entryType}
                  </Pill>
                </td>
                <td className="td num">{Number(e.quantityIn) || ""}</td>
                <td className="td num">{Number(e.quantityOut) || ""}</td>
                <td className="td num font-medium">{qty(e.runningBalance)}</td>
                <td className="td text-xs text-ink-muted">
                  {e.prescriberName ?? "-"}
                </td>
                <td className="td text-xs text-warn">
                  {e.reversalReason ?? ""}
                </td>
                <td className="td">
                  {e.entryType !== "REVERSAL" && !e.reversalOfId && (
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => reverse(e.id)}
                    >
                      Reverse
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          !register.loading && (
            <Empty>
              No register entries. Controlled medicines appear here once
              received or dispensed.
            </Empty>
          )
        )}
        <Pager
          page={register.page}
          pageSize={register.pageSize}
          total={register.total}
          onPage={register.setPage}
          loading={register.loading}
          noun="entry"
          plural="entries"
        />
      </Card>

      <Anomalies />
    </Shell>
  );
}

/**
 * Patterns worth investigating (§28: features 918-922).
 *
 * Diversion does not announce itself; it shows up as a pattern. Every signal
 * carries the arithmetic behind it so a supervisor can judge rather than trust,
 * and nothing here is a finding on its own — that is stated on the screen, not
 * only in the code, because an accusation dressed as a system output is how a
 * colleague gets wrongly suspended.
 */
function Anomalies() {
  const [days, setDays] = useState(90);
  const { data, error, loading, refresh } = useApi<any>(
    `/controlled-register/anomalies?days=${days}`,
    [days],
  );

  const signals: any[] = data?.signals ?? [];

  return (
    <div className="mt-4">
      {error && <ErrorState message={error} onRetry={refresh} />}
      {loading && !data && <Loading />}

      {data && (
        <Panel
          title="Patterns worth investigating"
          description={data.note}
          action={
            <select
              className="input w-auto py-1 text-small"
              aria-label="Period"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[30, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          }
          padded={false}
        >
          <div className="p-4">
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Entries examined"
                value={data.entriesExamined}
                sub="Controlled dispensings"
              />
              <Stat
                label="Signals"
                value={signals.length}
                tone={signals.length ? "warn" : "ok"}
                sub="Prompts, not findings"
              />
              <Stat
                label="High priority"
                value={signals.filter((s) => s.severity === "HIGH").length}
                tone={
                  signals.some((s) => s.severity === "HIGH") ? "danger" : "ok"
                }
                sub="Look at these first"
              />
            </div>

            {signals.length === 0 ? (
              <EmptyState
                title="No pattern stands out in this period"
                body="A quiet report is not a clean bill of health: it means nothing crossed the thresholds this check uses. Reconciliation against physical stock is the other half of the picture."
              />
            ) : (
              <DataTable
                rows={signals}
                getKey={(s: any) => `${s.type}:${s.subject}:${s.detail}`}
                pageSize={20}
                exportName="controlled-anomalies"
                searchPlaceholder="Search signal"
                rowTone={(s: any) =>
                  s.severity === "HIGH" ? "danger" : "warn"
                }
                columns={[
                  {
                    key: "severity",
                    label: "Priority",
                    width: "7rem",
                    value: (s: any) => s.severity,
                    render: (s: any) => <SeverityBadge level={s.severity} />,
                  },
                  {
                    key: "type",
                    label: "Pattern",
                    value: (s: any) => s.type,
                    render: (s: any) =>
                      s.type
                        .replace(/_/g, " ")
                        .toLowerCase()
                        .replace(/^./, (c: string) => c.toUpperCase()),
                  },
                  {
                    key: "detail",
                    label: "What was seen",
                    value: (s: any) => s.detail,
                  },
                  {
                    key: "subject",
                    label: "Subject",
                    optional: true,
                    value: (s: any) => s.subject,
                  },
                ]}
              />
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
