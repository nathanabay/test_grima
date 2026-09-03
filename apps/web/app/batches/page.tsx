"use client";

import Link from "next/link";
import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { can, money, qty, shortDate, tokenStore } from "@/lib/api";
import { BatchStatus, Card, Empty, ErrorBox, Loading, Table } from "@/components/ui";
import { ExpiryBadge } from "@/components/status";
import { Field, Toolbar } from "@/components/primitives";
import { BatchStatusDialog, type BatchAction } from "@/components/inventory/BatchStatusDialog";

const STATUSES = [
  "QUARANTINED",
  "RELEASED",
  "AVAILABLE",
  "BLOCKED",
  "DAMAGED",
  "RECALLED",
  "RETURNED",
  "EXPIRED",
  "DESTROYED",
];

const EXPIRY_WINDOWS = [
  { label: "Any expiry", value: "" },
  { label: "Expiring in 30 days", value: "30" },
  { label: "Expiring in 90 days", value: "90" },
  { label: "Expiring in 180 days", value: "180" },
];

export default function BatchesPage() {
  return (
    <Shell>
      <BatchesBody />
    </Shell>
  );
}

function BatchesBody() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [expiring, setExpiring] = useState("");
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [page, setPage] = useState(1);

  const [target, setTarget] = useState<any | null>(null);
  const [action, setAction] = useState<BatchAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canRelease = can(user, "quality.quarantine.APPROVE");
  const canQuarantine = can(user, "quality.quarantine.CREATE");

  const query = [
    `pageSize=50`,
    `page=${page}`,
    status ? `status=${status}` : "",
    search ? `search=${encodeURIComponent(search)}` : "",
    expiring ? `expiringWithinDays=${expiring}` : "",
    onlyInStock ? "onlyInStock=true" : "",
  ]
    .filter(Boolean)
    .join("&");

  const { data, error, loading, refresh } = useApi<any>(`/inventory/batches?${query}`, [query]);

  function open(batch: any, next: BatchAction) {
    setTarget(batch);
    setAction(next);
  }

  return (
    <>
      <PageHeader
        title="Batches"
        subtitle="Quarantine holds stock out of FEFO; release makes it allocatable. Both are recorded against the person who decided, with the evidence they decided on."
      />

      {message && (
        <div
          className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok"
          role="status"
        >
          {message}
        </div>
      )}

      <Card className="mb-4">
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(draft);
          }}
        >
          <Field label="Search">
            <input
              className="input"
              placeholder="Batch, lot, invoice, product or SKU"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expiry">
            <select
              className="input"
              value={expiring}
              onChange={(e) => {
                setPage(1);
                setExpiring(e.target.value);
              }}
            >
              {EXPIRY_WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1.5 pb-2 text-small">
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={(e) => {
                  setPage(1);
                  setOnlyInStock(e.target.checked);
                }}
              />
              Only with stock
            </label>
            <button className="btn-primary mb-0.5">Search</button>
          </div>
        </form>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <Loading />}

      {data && (
        <Card
          title={`${data.total.toLocaleString()} batch${data.total === 1 ? "" : "es"}`}
          action={
            <div className="flex items-center gap-2 text-sm">
              <button
                className="btn-ghost"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-ink-muted">Page {data.page}</span>
              <button
                className="btn-ghost"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          }
        >
          {data.data.length ? (
            <Table
              head={[
                "Batch",
                "Product",
                "Status",
                "Expiry",
                "On hand",
                "Available",
                "Value",
                "Supplier",
                "",
              ]}
            >
              {data.data.map((b: any) => (
                <tr key={b.id}>
                  <td className="td">
                    <Link className="font-medium text-brand underline" href={`/batches/${b.id}`}>
                      {b.batchNumber}
                    </Link>
                    {b._count?.childBatches > 0 && (
                      <div className="text-xs text-ink-subtle">
                        split into {b._count.childBatches}
                      </div>
                    )}
                  </td>
                  <td className="td">
                    <div>
                      {b.product.genericName} {b.product.strength}
                    </div>
                    <div className="text-xs text-ink-subtle">
                      {b.product.sku}
                      {b.product.isControlled && " · CONTROLLED"}
                      {b.product.isColdChain && " · COLD CHAIN"}
                    </div>
                  </td>
                  <td className="td">
                    <BatchStatus status={b.status} />
                    {b.quarantineReason && (
                      <div className="text-xs text-ink-subtle">
                        {b.quarantineReason.replace(/_/g, " ").toLowerCase()}
                      </div>
                    )}
                  </td>
                  <td className="td">
                    <div className="text-xs text-ink-muted">{shortDate(b.expiryDate)}</div>
                    <ExpiryBadge days={b.daysToExpiry} />
                  </td>
                  <td className="td num">{qty(b.onHand)}</td>
                  <td className="td num font-medium">{qty(b.available)}</td>
                  <td className="td num">{money(b.stockValue)}</td>
                  <td className="td text-xs text-ink-muted">{b.supplier?.companyName ?? "—"}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      {canRelease && ["QUARANTINED", "BLOCKED", "RETURNED"].includes(b.status) && (
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => open(b, "release")}
                        >
                          Release
                        </button>
                      )}
                      {canQuarantine &&
                        !["QUARANTINED", "DESTROYED", "EXPIRED"].includes(b.status) && (
                          <button
                            className="btn-ghost text-xs"
                            onClick={() => open(b, "quarantine")}
                          >
                            Quarantine
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No batches match this filter.</Empty>
          )}
        </Card>
      )}

      <BatchStatusDialog
        batch={target}
        action={action}
        onClose={() => {
          setAction(null);
          setTarget(null);
        }}
        onDone={() => {
          setMessage("Batch status updated.");
          refresh();
        }}
      />
    </>
  );
}
