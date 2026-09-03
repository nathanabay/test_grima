"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { api, qty, shortDate } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Table } from "@/components/ui";
import { StatusBadge } from "@/components/status";

/**
 * What is holding stock out of available (§19).
 *
 * `available` sits below `onHand` for a reason, and until this screen existed
 * there was no way to find out what the reason was without reading the
 * database. A storekeeper looking at "40 on hand, 12 available" needs to see
 * the baskets and the pick wave holding the difference — and, for the hold
 * nothing will ever come back for, a way to let it go.
 */
export function ReservationsPanel({
  canRelease,
  onChanged,
  onError,
}: {
  canRelease: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [onlyLapsed, setOnlyLapsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, refresh } = useApi<any>(
    `/inventory/reservations?pageSize=100${onlyLapsed ? "&onlyLapsed=true" : ""}`,
    [onlyLapsed],
  );

  async function release(row: any) {
    const reason = window.prompt(
      `Release ${qty(row.quantity)} held by ${row.referenceType.replace(/_/g, " ").toLowerCase()}?\nSay why:`,
    );
    if (!reason?.trim()) return;
    onError(null);
    setBusy(row.id);
    try {
      await api(`/inventory/reservations/${row.id}/release`, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      refresh();
      onChanged();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="Stock held out of available"
      action={
        <label className="flex items-center gap-1.5 text-small">
          <input
            type="checkbox"
            checked={onlyLapsed}
            onChange={(e) => setOnlyLapsed(e.target.checked)}
          />
          Only holds that have lapsed
        </label>
      }
    >
      {error && <ErrorBox message={error} />}
      {loading && <Loading />}

      {data?.data?.length ? (
        <>
          <Table
            head={["Product", "Batch", "Quantity", "Held by", "Held for", "Lapses", "Warehouse", ""]}
          >
            {data.data.map((row: any) => (
              <tr key={row.id} className={row.lapsed ? "bg-warn-light" : undefined}>
                <td className="td">
                  {row.product ? (
                    <>
                      <div className="font-medium">
                        {row.product.genericName} {row.product.strength}
                      </div>
                      <div className="text-xs text-ink-subtle">{row.product.sku}</div>
                    </>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
                <td className="td text-ink-muted">
                  {row.batch?.batchNumber ?? "—"}
                  {row.batch?.expiryDate && (
                    <div className="text-xs">{shortDate(row.batch.expiryDate)}</div>
                  )}
                </td>
                <td className="td num font-medium">{qty(row.quantity)}</td>
                <td className="td">
                  <StatusBadge tone="pending">
                    {row.referenceType.replace(/_/g, " ")}
                  </StatusBadge>
                  {row.createdBy && (
                    <div className="text-xs text-ink-subtle">{row.createdBy}</div>
                  )}
                </td>
                <td className="td num text-ink-muted">
                  {row.heldForMinutes < 60
                    ? `${row.heldForMinutes}m`
                    : `${Math.floor(row.heldForMinutes / 60)}h`}
                </td>
                <td className="td text-xs">
                  {row.expiresAt ? (
                    <span className={row.lapsed ? "font-medium text-warn" : "text-ink-muted"}>
                      {row.lapsed ? "lapsed" : shortDate(row.expiresAt)}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">never</span>
                  )}
                </td>
                <td className="td text-xs text-ink-muted">{row.warehouse?.name ?? "—"}</td>
                <td className="td">
                  {canRelease && (
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy === row.id}
                      onClick={() => release(row)}
                    >
                      {busy === row.id ? "Releasing…" : "Release"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-caption text-ink-subtle">
            Releasing a hold puts the stock back on sale. The document it belongs to is left as it
            is — that is a separate decision, and it belongs to whoever raised it.
          </p>
        </>
      ) : (
        !loading && (
          <Empty>
            {onlyLapsed
              ? "No hold has lapsed. The hourly job releases them as they do."
              : "Nothing is holding stock. Available equals on hand."}
          </Empty>
        )
      )}
    </Card>
  );
}
