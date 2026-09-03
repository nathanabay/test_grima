"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api, qty, shortDate } from "@/lib/api";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pager,
  Pill,
  Table,
} from "@/components/ui";

export default function RecallsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = usePaged<any>("/recalls", { pageSize: 25 });
  const detail = useApi<any>(selected ? `/recalls/${selected}` : null, [
    selected,
  ]);
  const [error, setError] = useState<string | null>(null);

  async function updateTask(taskId: string, recovered: number) {
    setError(null);
    try {
      await api(`/recalls/tasks/${taskId}`, {
        method: "POST",
        body: { status: "RECOVERED", quantityRecovered: recovered },
      });
      detail.refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Recall Management Center"
        subtitle="Activating a recall blocks the affected stock at the ledger, not just in the interface."
      />

      {list.error && <ErrorBox message={list.error} />}
      {list.loading && <Loading />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Recalls" className="lg:col-span-1">
          {list.rows.length ? (
            <div className="space-y-2">
              {list.rows.map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`w-full rounded-md border p-3 text-left text-sm ${
                    selected === r.id
                      ? "border-brand bg-brand-light"
                      : "border-surface-border hover:bg-surface-sunken"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.recallNo}</span>
                    <Pill tone={r.severity === "CLASS_I" ? "danger" : "warn"}>
                      {r.severity}
                    </Pill>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted line-clamp-2">
                    {r.reason}
                  </div>
                  <div className="mt-1 text-xs text-ink-subtle">
                    {shortDate(r.recallDate)} · {r.batches.length} batch(es) ·{" "}
                    {r.tasks.filter((t: any) => t.status === "PENDING").length}{" "}
                    pending
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No recalls have been raised.</Empty>
          )}
          <Pager
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={list.setPage}
            loading={list.loading}
            noun="recall"
          />
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {error && <ErrorBox message={error} />}
          {detail.loading && <Loading />}
          {!selected && (
            <Card>
              <Empty>Select a recall to see its dashboard.</Empty>
            </Card>
          )}

          {detail.data && (
            <>
              <Card
                title={`${detail.data.recall.recallNo} — ${detail.data.recall.severity}`}
              >
                <p className="text-sm text-ink-muted">
                  {detail.data.recall.reason}
                </p>
                {detail.data.recall.regulatoryReference && (
                  <p className="mt-1 text-xs text-ink-subtle">
                    Regulatory reference:{" "}
                    {detail.data.recall.regulatoryReference}
                  </p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Total affected", detail.data.totals.totalAffected],
                    ["In stock", detail.data.totals.inStock],
                    ["Dispensed", detail.data.totals.dispensed],
                    ["Recovered", detail.data.totals.recovered],
                    ["Returned", detail.data.totals.returned],
                    ["Destroyed", detail.data.totals.destroyed],
                    ["Outstanding", detail.data.totals.outstanding],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-md bg-surface-sunken p-2"
                    >
                      <div className="text-xs text-ink-muted">{label}</div>
                      <div className="text-lg font-semibold num">
                        {qty(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Affected batches">
                <Table
                  head={[
                    "Batch",
                    "Product",
                    "Status",
                    "In stock",
                    "Dispensed",
                    "Recovered",
                  ]}
                >
                  {detail.data.batches.map((b: any) => (
                    <tr key={b.batchId}>
                      <td className="td font-medium">{b.batchNumber}</td>
                      <td className="td">
                        {b.product}
                        <div className="text-xs text-ink-subtle">{b.sku}</div>
                      </td>
                      <td className="td">
                        <Pill tone="danger">{b.currentStatus}</Pill>
                      </td>
                      <td className="td num">{qty(b.inStockAtActivation)}</td>
                      <td className="td num">{qty(b.dispensedHistorical)}</td>
                      <td className="td num">{qty(b.recovered)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>

              <Card
                title={`Recall tasks — ${detail.data.tasks.pending} pending of ${detail.data.tasks.total}`}
              >
                <TaskList
                  recallId={detail.data.recall.id}
                  onUpdate={updateTask}
                />
              </Card>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

function TaskList({
  recallId,
  onUpdate,
}: {
  recallId: string;
  onUpdate: (taskId: string, recovered: number) => void;
}) {
  // This used to fire `/recalls?pageSize=1` as well and use nothing but its
  // loading flag — a request per render that answered no question.
  const detail = useApi<any>(`/recalls/${recallId}`, [recallId]);

  if (detail.loading) return <Loading />;
  const byType = detail.data?.tasks?.byType ?? {};

  return (
    <div className="space-y-2 text-sm">
      {Object.entries(byType).map(([type, count]) => (
        <div
          key={type}
          className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2"
        >
          <span className="font-medium">{type.replace(/_/g, " ")}</span>
          <span className="num text-ink-muted">{String(count)} task(s)</span>
        </div>
      ))}
      <p className="text-xs text-ink-subtle">
        Stock-blocking tasks are created per holding location;
        patient-notification tasks are created from the historical dispensing
        records for the batch.
      </p>
    </div>
  );
}
