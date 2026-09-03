"use client";

import { useApi } from "@/lib/useApi";
import { qty, shortDate } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Table } from "@/components/ui";

/**
 * Stock positions that need a person to look at them (§19).
 *
 * Negative stock is arithmetically impossible and always means a movement was
 * posted out of order or a count was applied twice. Nothing here corrects
 * anything: a stock figure is corrected by a count or an adjustment, and both
 * of those are somebody's decision, recorded under their name.
 */

const GROUPS: { key: string; title: string }[] = [
  { key: "negative", title: "Negative on hand" },
  { key: "overReserved", title: "More reserved than held" },
  { key: "heldAtZero", title: "Held at zero" },
  { key: "expiredButAvailable", title: "Expired but still counted" },
];

export function AnomaliesPanel({ warehouseId }: { warehouseId?: string }) {
  const { data, error, loading } = useApi<any>(
    `/inventory/anomalies${warehouseId ? `?warehouseId=${warehouseId}` : ""}`,
    [warehouseId],
  );

  if (error) return <ErrorBox message={error} />;
  if (loading) return <Loading />;
  if (!data) return null;

  const total = GROUPS.reduce((n, g) => n + (data[g.key]?.count ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card title={`${data.checked.toLocaleString()} position(s) checked`}>
        {total === 0 ? (
          <Empty>
            Nothing looks wrong. Every position is non-negative, reserved no more than it holds,
            and no expired batch is still counted as available.
          </Empty>
        ) : (
          <p className="text-small text-ink-muted">{data.note}</p>
        )}
      </Card>

      {GROUPS.map((group) => {
        const section = data[group.key];
        if (!section?.count) return null;
        return (
          <Card key={group.key} title={`${group.title} — ${section.count}`}>
            <p className="mb-2 text-small text-ink-muted">{section.meaning}</p>
            <Table head={["Product", "Batch", "Warehouse", "On hand", "Reserved", "Last movement"]}>
              {section.rows.map((row: any) => (
                <tr key={row.balanceId}>
                  <td className="td">
                    <div className="font-medium">
                      {row.product?.genericName} {row.product?.strength}
                    </div>
                    <div className="text-xs text-ink-subtle">{row.product?.sku}</div>
                  </td>
                  <td className="td text-ink-muted">
                    {row.batch?.batchNumber ?? "—"}
                    {row.batch?.expiryDate && (
                      <div className="text-xs">{shortDate(row.batch.expiryDate)}</div>
                    )}
                  </td>
                  <td className="td text-xs text-ink-muted">{row.warehouse?.name}</td>
                  <td className="td num font-medium">{qty(row.onHand)}</td>
                  <td className="td num text-ink-muted">{qty(row.reserved)}</td>
                  <td className="td text-xs text-ink-muted">
                    {row.lastMovementAt ? shortDate(row.lastMovementAt) : "—"}
                  </td>
                </tr>
              ))}
            </Table>
            {section.count > section.rows.length && (
              <p className="mt-2 text-caption text-ink-subtle">
                Showing the first {section.rows.length} of {section.count}.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
