"use client";

import Link from "next/link";
import { useApi } from "@/lib/useApi";
import { money, qty, shortDate } from "@/lib/api";
import { Drawer } from "@/components/primitives";
import { BatchStatus, Empty, ErrorBox, Loading, Table } from "@/components/ui";
import { ExpiryBadge } from "@/components/status";

/**
 * One stock position, opened from a row (§19).
 *
 * The list answers "how much"; this answers the questions that follow it — what
 * is holding it, how it got here, who else has this product, and what a person
 * can do about it next. Everything shown is fetched for the batch the row
 * names, so nothing here can disagree with the row it was opened from.
 */
export function StockPositionDrawer({
  position,
  onClose,
  canRelease,
  canCount,
  canAdjust,
  canTransfer,
  onChanged,
  onError,
}: {
  position: any | null;
  onClose: () => void;
  canRelease: boolean;
  canCount: boolean;
  canAdjust: boolean;
  canTransfer: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const batchId = position?.batch?.id ?? null;
  const productId = position?.product?.id ?? null;

  const movements = useApi<any>(
    batchId ? `/inventory/ledger/batch/${batchId}?warehouseId=${position.warehouseId}` : null,
    [batchId, position?.warehouseId],
  );
  const holds = useApi<any>(
    batchId ? `/inventory/reservations?batchId=${batchId}&warehouseId=${position.warehouseId}` : null,
    [batchId, position?.warehouseId],
  );
  const elsewhere = useApi<any>(
    productId ? `/inventory/products/${productId}/branches?excludeBranchId=${position.branchId}` : null,
    [productId, position?.branchId],
  );

  if (!position) return null;

  const reorderLevel = Number(position.product.reorderLevel ?? 0);
  const available = Number(position.available);
  const shortBy = reorderLevel > 0 ? reorderLevel - available : 0;

  return (
    <Drawer
      open={!!position}
      onClose={onClose}
      width="xl"
      title={`${position.product.genericName} ${position.product.strength ?? ""}`.trim()}
      description={
        position.batch
          ? `Batch ${position.batch.batchNumber} in ${position.warehouse.name}`
          : position.warehouse.name
      }
    >
      <div className="space-y-5">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="On hand" value={qty(position.onHand)} />
          <Figure label="Reserved" value={qty(position.reserved)} muted />
          <Figure label="Available" value={qty(position.available)} strong />
          <Figure label="Value at cost" value={money(position.stockValue)} />
        </section>

        <section className="rounded-md border border-border p-3 text-small">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-ink-muted">SKU</dt>
            <dd className="text-right">{position.product.sku}</dd>
            <dt className="text-ink-muted">Batch status</dt>
            <dd className="text-right">
              {position.batch ? <BatchStatus status={position.batch.status} /> : "—"}
            </dd>
            <dt className="text-ink-muted">Expires</dt>
            <dd className="flex items-center justify-end gap-2 text-right">
              {shortDate(position.batch?.expiryDate)}
              <ExpiryBadge days={position.daysToExpiry} />
            </dd>
            <dt className="text-ink-muted">Received</dt>
            <dd className="text-right">
              {position.batch?.receivedDate ? shortDate(position.batch.receivedDate) : "—"}
              {position.ageDays !== null && (
                <span className="ml-1 text-ink-subtle">({position.ageDays}d ago)</span>
              )}
            </dd>
            <dt className="text-ink-muted">Location</dt>
            <dd className="text-right">
              {position.location ? `${position.location.code} · ${position.location.name}` : "—"}
            </dd>
            <dt className="text-ink-muted">Reorder level</dt>
            <dd className="text-right">
              {reorderLevel > 0 ? qty(reorderLevel) : "not set"}
              {shortBy > 0 && (
                <span className="ml-1 font-medium text-warn">short by {qty(shortBy)}</span>
              )}
            </dd>
          </dl>

          {position.batch && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn-ghost btn-sm" href={`/batches/${position.batch.id}`}>
                Batch record
              </Link>
              {canCount && (
                <Link
                  className="btn-ghost btn-sm"
                  href={`/counts?productId=${position.product.id}&warehouseId=${position.warehouseId}`}
                >
                  Count it
                </Link>
              )}
              {canAdjust && (
                <Link
                  className="btn-ghost btn-sm"
                  href={`/adjustments?productId=${position.product.id}&batchId=${position.batch.id}&warehouseId=${position.warehouseId}`}
                >
                  Adjust
                </Link>
              )}
              {canTransfer && (
                <Link
                  className="btn-ghost btn-sm"
                  href={`/transfers?productId=${position.product.id}&fromWarehouseId=${position.warehouseId}`}
                >
                  Transfer out
                </Link>
              )}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-small font-semibold">
            What is holding it
            {Number(position.reserved) > 0 && ` · ${qty(position.reserved)} reserved`}
          </h3>
          {holds.loading && <Loading />}
          {holds.error && <ErrorBox message={holds.error} />}
          {holds.data?.data?.length ? (
            <ul className="space-y-1 text-small">
              {holds.data.data.map((h: any) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between rounded-md border border-border px-2 py-1"
                >
                  <span>
                    {h.referenceType.replace(/_/g, " ").toLowerCase()} · {qty(h.quantity)}
                    {h.createdBy && (
                      <span className="ml-1 text-ink-subtle">by {h.createdBy}</span>
                    )}
                  </span>
                  <span className={h.lapsed ? "text-caption font-medium text-warn" : "text-caption text-ink-muted"}>
                    {h.lapsed ? "lapsed" : h.expiresAt ? `until ${shortDate(h.expiresAt)}` : "no expiry"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            !holds.loading && (
              <p className="text-small text-ink-muted">
                Nothing is holding this position — available equals on hand.
              </p>
            )
          )}
        </section>

        <section>
          <h3 className="mb-2 text-small font-semibold">How it got here</h3>
          {movements.loading && <Loading />}
          {movements.error && <ErrorBox message={movements.error} />}
          {movements.data?.length ? (
            <div className="max-h-64 overflow-y-auto">
              <Table head={["When", "Movement", "In", "Out", "Balance", "Document"]}>
                {[...movements.data].reverse().map((m: any) => (
                  <tr key={m.id}>
                    <td className="td text-xs text-ink-muted">{shortDate(m.occurredAt)}</td>
                    <td className="td text-xs">{m.type.replace(/_/g, " ")}</td>
                    <td className="td num text-xs">
                      {Number(m.quantityIn) > 0 ? qty(m.quantityIn) : ""}
                    </td>
                    <td className="td num text-xs">
                      {Number(m.quantityOut) > 0 ? qty(m.quantityOut) : ""}
                    </td>
                    <td className="td num text-xs font-medium">{qty(m.balanceAfter)}</td>
                    <td className="td text-xs">
                      {m.referenceHref ? (
                        <Link className="text-brand underline" href={m.referenceHref}>
                          {m.referenceNo ?? m.referenceType}
                        </Link>
                      ) : (
                        (m.referenceNo ?? "—")
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : (
            !movements.loading && <Empty>No movements recorded for this batch here.</Empty>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-small font-semibold">Who else has it</h3>
          {elsewhere.loading && <Loading />}
          {Array.isArray(elsewhere.data) && elsewhere.data.length ? (
            <ul className="space-y-1 text-small">
              {elsewhere.data.slice(0, 10).map((row: any, i: number) => (
                <li
                  key={`${row.warehouse?.id ?? i}-${row.batch?.batchNumber ?? i}`}
                  className="flex items-center justify-between rounded-md bg-surface-sunken px-2 py-1"
                >
                  <span>
                    {row.warehouse?.branch?.name ?? row.warehouse?.name}
                    {row.batch?.batchNumber && (
                      <span className="ml-1 text-ink-subtle">batch {row.batch.batchNumber}</span>
                    )}
                  </span>
                  <span className="num">{qty(row.onHand)}</span>
                </li>
              ))}
            </ul>
          ) : (
            !elsewhere.loading && (
              <p className="text-small text-ink-muted">
                No other branch is holding this product. Ordering it is the only way to get more.
              </p>
            )
          )}
        </section>
      </div>
    </Drawer>
  );
}

function Figure({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-caption text-ink-muted">{label}</div>
      <div
        className={`num text-section ${strong ? "font-semibold" : ""} ${muted ? "text-ink-muted" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
