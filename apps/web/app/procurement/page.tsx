"use client";

import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { can, money, qty, shortDate, tokenStore } from "@/lib/api";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pager,
  Pill,
  Table,
} from "@/components/ui";

export default function ProcurementPage() {
  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const replenishment = useApi<any[]>("/replenishment/recommendations");
  const orders = usePaged<any>("/purchase-orders", { pageSize: 15 });
  // Gated rather than fetched-and-swallowed: a finance officer reads purchase
  // orders but not supplier scorecards, and firing a request their permissions
  // refuse leaves a silently missing panel and a 403 in the log.
  const suppliers = useApi<any[]>(
    can(user, "procurement.supplier.READ") ? "/suppliers/performance" : null,
  );

  return (
    <Shell>
      <PageHeader
        title="Procurement"
        subtitle="Reorder suggestions show their full calculation. Nothing is ordered automatically."
      />

      <div className="space-y-4">
        <Card
          title="Replenishment recommendations"
          action={
            <span className="text-xs text-ink-subtle">
              Advisory only — an officer must raise the order
            </span>
          }
        >
          {replenishment.loading && <Loading />}
          {replenishment.error && <ErrorBox message={replenishment.error} />}
          {replenishment.data?.length ? (
            <Table
              head={[
                "Product",
                "Available",
                "Position",
                "Reorder point",
                "Suggested",
                "Est. cost",
                "Why",
              ]}
            >
              {replenishment.data.slice(0, 25).map((r) => (
                <tr key={r.productId}>
                  <td className="td">
                    <div className="font-medium">{r.productName}</div>
                    <div className="text-xs text-ink-subtle">
                      {r.sku} · {r.strength}
                    </div>
                  </td>
                  <td
                    className={`td num ${r.available <= 0 ? "text-danger font-medium" : ""}`}
                  >
                    {qty(r.available)}
                  </td>
                  <td className="td num text-ink-muted">
                    {qty(r.inventoryPosition)}
                  </td>
                  <td className="td num text-ink-muted">
                    {qty(Math.round(r.reorderPoint))}
                  </td>
                  <td className="td num font-medium">
                    {qty(r.suggestedQuantity)} {r.unit}
                  </td>
                  <td className="td num">{money(r.estimatedCost)}</td>
                  <td className="td text-xs text-ink-subtle max-w-md">
                    {r.explanation}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !replenishment.loading && (
              <Empty>Every product is above its reorder point.</Empty>
            )
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Purchase orders">
            {orders.loading && <Loading />}
            {orders.rows.length ? (
              <Table head={["PO", "Supplier", "Status", "Expected", "Total"]}>
                {orders.rows.map((po: any) => (
                  <tr key={po.id}>
                    <td className="td font-medium">{po.poNo}</td>
                    <td className="td">{po.supplier.companyName}</td>
                    <td className="td">
                      <Pill
                        tone={
                          po.status === "RECEIVED" || po.status === "CLOSED"
                            ? "ok"
                            : po.status === "CANCELLED"
                              ? "danger"
                              : po.status === "DRAFT"
                                ? "neutral"
                                : "info"
                        }
                      >
                        {po.status.replace(/_/g, " ")}
                      </Pill>
                    </td>
                    <td className="td text-ink-muted">
                      {shortDate(po.expectedDate)}
                    </td>
                    <td className="td num">{money(po.grandTotal)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              !orders.loading && <Empty>No purchase orders yet.</Empty>
            )}
          <Pager
            page={orders.page}
            pageSize={orders.pageSize}
            total={orders.total}
            onPage={orders.setPage}
            loading={orders.loading}
            noun="purchase order"
          />
        </Card>

          <Card title="Supplier scorecard">
            {suppliers.loading && <Loading />}
            {suppliers.data?.length ? (
              <Table
                head={["Supplier", "Score", "On time", "Rejects", "Licence"]}
              >
                {suppliers.data.slice(0, 20).map((s) => (
                  <tr key={s.id}>
                    <td className="td">
                      {s.companyName}
                      <div className="text-xs text-ink-subtle">{s.code}</div>
                    </td>
                    <td className="td num font-medium">
                      {Number(s.supplierScore).toFixed(1)}
                    </td>
                    <td className="td num">
                      {(Number(s.onTimeDeliveryRate) * 100).toFixed(0)}%
                    </td>
                    <td className="td num">
                      {(Number(s.rejectionRate) * 100).toFixed(1)}%
                    </td>
                    <td className="td">
                      <Pill
                        tone={
                          s.licenceStatus === "VALID"
                            ? "ok"
                            : s.licenceStatus === "EXPIRING_SOON"
                              ? "warn"
                              : "danger"
                        }
                      >
                        {s.licenceStatus.replace(/_/g, " ")}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              !suppliers.loading && <Empty>No suppliers registered.</Empty>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
