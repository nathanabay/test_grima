"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { can, money, qty, shortDate, tokenStore } from "@/lib/api";
import { BatchStatus, Card, Empty, ErrorBox, Loading, Table } from "@/components/ui";
import { ExpiryBadge, StatusBadge } from "@/components/status";
import { Stat } from "@/components/primitives";
import { BatchStatusDialog, type BatchAction } from "@/components/inventory/BatchStatusDialog";
import { BatchSplitDialog } from "@/components/inventory/BatchSplitDialog";

/**
 * The batch record (§7, §16).
 *
 * There was no such page: a batch could be listed and its status changed from
 * the list, and that was all. Everything a recall, an inspection or a quality
 * investigation actually asks for — where the stock is, what it cost, what
 * moved, what it was split from, which serials belong to it, and who decided
 * its status and on what evidence — had to be assembled by hand from the
 * database.
 */
export default function BatchPage() {
  return (
    <Shell>
      <BatchBody />
    </Shell>
  );
}

function BatchBody() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canRelease = can(user, "quality.quarantine.APPROVE");
  const canQuarantine = can(user, "quality.quarantine.CREATE");
  const canEdit = can(user, "inventory.batch.EDIT");

  const [action, setAction] = useState<BatchAction | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: batch, error, loading, refresh } = useApi<any>(
    id ? `/inventory/batches/${id}` : null,
    [id],
  );
  const movements = useApi<any>(id ? `/inventory/ledger/batch/${id}` : null, [id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!batch) return null;

  const expired = batch.daysToExpiry < 0;

  return (
    <>
      <PageHeader
        title={`Batch ${batch.batchNumber}`}
        subtitle={`${batch.product.genericName} ${batch.product.strength ?? ""} · ${batch.product.sku}`}
        action={
          <div className="flex flex-wrap gap-2">
            {canRelease && ["QUARANTINED", "BLOCKED", "RETURNED"].includes(batch.status) && (
              <button className="btn-primary" onClick={() => setAction("release")}>
                Release
              </button>
            )}
            {canQuarantine && !["QUARANTINED", "DESTROYED", "EXPIRED"].includes(batch.status) && (
              <button className="btn-ghost" onClick={() => setAction("quarantine")}>
                Quarantine
              </button>
            )}
            {canEdit && !["DESTROYED", "EXPIRED"].includes(batch.status) && (
              <>
                <button className="btn-ghost" onClick={() => setAction("block")}>
                  Block
                </button>
                <button className="btn-ghost" onClick={() => setSplitting(true)}>
                  Split
                </button>
              </>
            )}
          </div>
        }
      />

      {message && (
        <div
          className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok"
          role="status"
        >
          {message}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="On hand" value={qty(batch.onHand)} />
        <Stat label="Reserved" value={qty(batch.reserved)} />
        <Stat label="Available" value={qty(batch.available)} />
        <Stat label="Value at cost" value={money(batch.stockValue)} />
        <Stat
          label="Expires"
          value={shortDate(batch.expiryDate)}
          sub={expired ? "expired" : `in ${batch.daysToExpiry} days`}
          tone={expired ? "danger" : batch.daysToExpiry < 90 ? "warn" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="The batch" className="lg:col-span-1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-small">
            <dt className="text-ink-muted">Status</dt>
            <dd className="text-right">
              <BatchStatus status={batch.status} />
            </dd>
            {batch.quarantineReason && (
              <>
                <dt className="text-ink-muted">Quarantined for</dt>
                <dd className="text-right">{batch.quarantineReason.replace(/_/g, " ")}</dd>
              </>
            )}
            <dt className="text-ink-muted">Expiry</dt>
            <dd className="flex items-center justify-end gap-2 text-right">
              {shortDate(batch.expiryDate)}
              <ExpiryBadge days={batch.daysToExpiry} />
            </dd>
            <dt className="text-ink-muted">Lot</dt>
            <dd className="text-right">{batch.lotNumber ?? "—"}</dd>
            <dt className="text-ink-muted">Manufactured</dt>
            <dd className="text-right">
              {batch.manufacturingDate ? shortDate(batch.manufacturingDate) : "—"}
            </dd>
            <dt className="text-ink-muted">Manufacturer</dt>
            <dd className="text-right">{batch.manufacturerName ?? "—"}</dd>
            <dt className="text-ink-muted">Received</dt>
            <dd className="text-right">{shortDate(batch.receivedDate)}</dd>
            <dt className="text-ink-muted">Received quantity</dt>
            <dd className="num text-right">{qty(batch.receivedQuantity)}</dd>
            <dt className="text-ink-muted">Cost per unit</dt>
            <dd className="num text-right">{money(batch.purchaseCost)}</dd>
            <dt className="text-ink-muted">Supplier</dt>
            <dd className="text-right">{batch.supplier?.companyName ?? "—"}</dd>
            <dt className="text-ink-muted">Supplier invoice</dt>
            <dd className="text-right">{batch.supplierInvoiceNo ?? "—"}</dd>
            {batch.releasedAt && (
              <>
                <dt className="text-ink-muted">Released</dt>
                <dd className="text-right">{shortDate(batch.releasedAt)}</dd>
              </>
            )}
          </dl>

          {batch.qualityNotes && (
            <p className="mt-3 rounded-md bg-surface-sunken p-2 text-small">
              {batch.qualityNotes}
            </p>
          )}
        </Card>

        <Card title="Where it is" className="lg:col-span-2">
          {batch.balances?.length ? (
            <Table head={["Warehouse", "Location", "On hand", "Reserved", "Available"]}>
              {batch.balances.map((b: any) => (
                <tr key={b.id}>
                  <td className="td">{b.warehouse?.name ?? "—"}</td>
                  <td className="td text-ink-muted">
                    {b.location ? `${b.location.code} · ${b.location.name}` : "—"}
                  </td>
                  <td className="td num">{qty(b.onHand)}</td>
                  <td className="td num text-ink-muted">{qty(b.reserved)}</td>
                  <td className="td num font-medium">
                    {qty(Number(b.onHand) - Number(b.reserved))}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>None of this batch is held in a branch you can see.</Empty>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="What happened to the quantity">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-small">
            {Object.entries(batch.movementTotals ?? {})
              .filter(([, v]) => Number(v) > 0)
              .map(([k, v]) => (
                <div key={k} className="col-span-2 flex justify-between">
                  <dt className="text-ink-muted">
                    {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                  </dt>
                  <dd className="num">{qty(v as string)}</dd>
                </div>
              ))}
          </dl>
          {Object.values(batch.movementTotals ?? {}).every((v) => Number(v) === 0) && (
            <Empty>Nothing has left this batch yet.</Empty>
          )}
          <p className="mt-2 text-caption text-ink-subtle">
            Read from the ledger rather than stored beside it, so these cannot drift from the
            movements they summarise.
          </p>
        </Card>

        <Card title="How fast it is moving">
          {batch.consumption?.windowDays > 0 ? (
            <>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-small">
                <dt className="text-ink-muted">Supplied</dt>
                <dd className="num text-right">{qty(batch.consumption.unitsSupplied)}</dd>
                <dt className="text-ink-muted">Per day</dt>
                <dd className="num text-right">{batch.consumption.perDay}</dd>
                <dt className="text-ink-muted">Days of cover left</dt>
                <dd className="num text-right">
                  {Number(batch.consumption.perDay) > 0
                    ? Math.floor(Number(batch.available) / Number(batch.consumption.perDay))
                    : "—"}
                </dd>
                <dt className="text-ink-muted">Days to expiry</dt>
                <dd className="num text-right">{batch.daysToExpiry}</dd>
              </dl>
              {Number(batch.consumption.perDay) > 0 &&
                Math.floor(Number(batch.available) / Number(batch.consumption.perDay)) >
                  batch.daysToExpiry && (
                  <p className="mt-2 rounded-md border border-warn/40 bg-warn-light px-2 py-1 text-small">
                    At this rate the batch expires before it is used. Consider moving it to a
                    branch that will get through it.
                  </p>
                )}
            </>
          ) : (
            <Empty>{batch.consumption?.note ?? "Nothing has been supplied from this batch."}</Empty>
          )}
          <p className="mt-2 text-caption text-ink-subtle">
            {batch.consumption?.note}
          </p>
        </Card>
      </div>

      {(batch.parentBatch || batch.childBatches?.length) && (
        <Card title="Genealogy" className="mt-4">
          {batch.parentBatch && (
            <p className="mb-2 text-small">
              Split from{" "}
              <Link className="text-brand underline" href={`/batches/${batch.parentBatch.id}`}>
                {batch.parentBatch.batchNumber}
              </Link>
              .
            </p>
          )}
          {batch.childBatches?.length > 0 && (
            <Table head={["Batch", "Status", "Expires", "Quantity", ""]}>
              {batch.childBatches.map((c: any) => (
                <tr key={c.id}>
                  <td className="td font-medium">{c.batchNumber}</td>
                  <td className="td">
                    <BatchStatus status={c.status} />
                  </td>
                  <td className="td text-ink-muted">{shortDate(c.expiryDate)}</td>
                  <td className="td num">{qty(c.receivedQuantity)}</td>
                  <td className="td">
                    <Link className="btn-ghost text-xs" href={`/batches/${c.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {batch.recallLinks?.length > 0 && (
        <Card title="Recalls" className="mt-4">
          <ul className="space-y-1 text-small">
            {batch.recallLinks.map((link: any) => (
              <li
                key={link.id}
                className="flex items-center justify-between rounded-md border border-danger/30 bg-danger-light px-2 py-1"
              >
                <span>
                  {link.recall?.recallNo} · {link.recall?.severity?.replace(/_/g, " ")}
                </span>
                <Link className="text-brand underline" href="/recalls">
                  Open the recall
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Movements" className="mt-4">
        {movements.loading && <Loading />}
        {movements.error && <ErrorBox message={movements.error} />}
        {movements.data?.length ? (
          <Table head={["When", "Movement", "In", "Out", "Balance", "Cost", "Document", "Reason"]}>
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
                <td className="td num text-xs text-ink-muted">{money(m.unitCost)}</td>
                <td className="td text-xs">
                  {m.referenceHref ? (
                    <Link className="text-brand underline" href={m.referenceHref}>
                      {m.referenceNo ?? m.referenceType}
                    </Link>
                  ) : (
                    (m.referenceNo ?? "—")
                  )}
                </td>
                <td className="td text-xs text-ink-subtle">{m.reason ?? ""}</td>
              </tr>
            ))}
          </Table>
        ) : (
          !movements.loading && <Empty>No movements recorded for this batch.</Empty>
        )}
      </Card>

      {batch.serials?.length > 0 && (
        <Card title={`Serial numbers · ${batch.serials.length}`} className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {batch.serials.map((s: any) => (
              <span
                key={s.id}
                className="rounded-md border border-border px-1.5 py-0.5 text-caption"
                title={s.status}
              >
                {s.serial}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card title="What happened to it" className="mt-4">
        {batch.history?.length ? (
          <Table head={["When", "What", "By", "From", "To", "Reason"]}>
            {batch.history.map((h: any, i: number) => (
              <tr key={i}>
                <td className="td text-xs text-ink-muted">{shortDate(h.createdAt)}</td>
                <td className="td text-xs">
                  <StatusBadge tone="info">{h.action.replace(/_/g, " ")}</StatusBadge>
                </td>
                <td className="td text-xs">{h.userLabel ?? "—"}</td>
                <td className="td text-xs text-ink-muted">
                  {(h.previousValue as any)?.status ?? "—"}
                </td>
                <td className="td text-xs">{(h.newValue as any)?.status ?? "—"}</td>
                <td className="td text-xs text-ink-subtle">
                  {h.reason ?? ""}
                  {(h.newValue as any)?.evidenceRef && (
                    <span className="ml-1 font-medium">
                      [{(h.newValue as any).evidenceRef}]
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>Nothing has changed on this batch since it was received.</Empty>
        )}
      </Card>

      <BatchStatusDialog
        batch={batch}
        action={action}
        onClose={() => setAction(null)}
        onDone={() => {
          setMessage("Batch status updated.");
          refresh();
        }}
      />

      <BatchSplitDialog
        batch={batch}
        open={splitting}
        onClose={() => setSplitting(false)}
        onDone={(child) => {
          setMessage(`Split into ${child.batchNumber}.`);
          refresh();
          router.push(`/batches/${child.id}`);
        }}
      />
    </>
  );
}
