"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, money, qty, shortDate, tokenStore } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";
import { Scanner, ScanResolution } from "@/components/Scanner";

interface ReceiptLine {
  key: string;
  productId: string;
  productLabel: string;
  batchNumber: string;
  expiryDate: string;
  manufacturingDate: string;
  quantity: string;
  unitCost: string;
  rejectedQty: string;
  rejectionReason: string;
  packagingDamaged: boolean;
  outstanding?: number;
}

export default function ReceivingPage() {
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [poId, setPoId] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);

    // The reader's own branches and warehouses. Not `/admin/organization`, which
  // requires admin.branch.READ and therefore fails for every operational role.
  const org = useApi<any>("/auth/me/scope");
  /*
   * The orders this delivery can be booked against.
   *
   * `/purchase-orders` needs procurement.purchase_order.READ, which a
   * storekeeper does not hold — so the "Against purchase order" list was empty
   * for the only role that receives deliveries. This endpoint carries the
   * ordered lines and what is still outstanding on each, and no money.
   */
  const orders = useApi<any>("/purchase-orders/receivable");
  const selectedOrder = (orders.data ?? []).find((o: any) => o.id === poId) ?? null;
  const recent = useApi<any>(
    warehouseId
      ? `/goods-receipts?warehouseId=${warehouseId}&pageSize=10`
      : null,
    [warehouseId, receipt],
  );

  useEffect(() => {
    if (!org.data) return;
    const user = tokenStore.user;
    const allowed = user?.branchIds.length
      ? org.data.branches.filter((b: any) => user.branchIds.includes(b.id))
      : org.data.branches;
    setBranches(allowed);
    const first = allowed[0];
    if (first) {
      setBranchId(first.id);
      setWarehouseId(
        first.warehouses.find((w: any) => !w.isColdRoom)?.id ?? "",
      );
    }
  }, [org.data]);

  // Selecting a purchase order pre-fills the lines still outstanding on it.
  useEffect(() => {
    if (!selectedOrder) return;
    setBranchId(selectedOrder.branchId);
    setWarehouseId(selectedOrder.warehouseId);
    setLines(
      selectedOrder.items
        .filter((i: any) => Number(i.outstandingQty) > 0)
        .map((i: any, idx: number) => ({
          key: `po-${idx}`,
          productId: i.productId,
          // The order names the medicine, so the storekeeper checking the
          // pallet against the paperwork reads a name rather than an id.
          productLabel: i.product
            ? `${i.product.genericName} ${i.product.strength ?? ""}`.trim()
            : i.productId.slice(0, 8),
          batchNumber: "",
          expiryDate: "",
          manufacturingDate: "",
          quantity: String(Number(i.outstandingQty)),
          unitCost: "",
          rejectedQty: "",
          rejectionReason: "",
          packagingDamaged: false,
          outstanding: Number(i.outstandingQty),
        })),
    );
  }, [selectedOrder]);

  /** A GS1 scan fills product, batch and expiry in one action (§15, §17). */
  function applyScan(result: ScanResolution) {
    setError(null);
    if (!result.product) {
      setError("Scanned code does not match any product in the drug master.");
      return;
    }
    const label = `${result.product.genericName} ${result.product.strength}`;

    setLines((current) => {
      const existing = current.findIndex(
        (l) => l.productId === result.product!.id && !l.batchNumber,
      );
      const filled = {
        productLabel: label,
        batchNumber: result.parsed.batchNumber ?? "",
        expiryDate: result.parsed.expiryDate
          ? result.parsed.expiryDate.slice(0, 10)
          : "",
      };
      if (existing >= 0) {
        return current.map((l, i) =>
          i === existing ? { ...l, ...filled } : l,
        );
      }
      return [
        ...current,
        {
          key: `scan-${Date.now()}`,
          productId: result.product!.id,
          quantity: "",
          unitCost: "",
          manufacturingDate: "",
          rejectedQty: "",
          rejectionReason: "",
          packagingDamaged: false,
          ...filled,
        },
      ];
    });

    if (!result.parsed.isGs1) {
      setError(
        "Not a GS1 DataMatrix: enter and verify the batch and expiry by hand.",
      );
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const payload = lines.map((l) => ({
        productId: l.productId,
        batchNumber: l.batchNumber,
        expiryDate: l.expiryDate,
        manufacturingDate: l.manufacturingDate || undefined,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
        rejectedQty: l.rejectedQty ? Number(l.rejectedQty) : undefined,
        rejectionReason: l.rejectionReason || undefined,
        packagingDamaged: l.packagingDamaged,
      }));
      const result = await api("/goods-receipts", {
        method: "POST",
        body: {
          purchaseOrderId: poId || undefined,
          supplierId: selectedOrder?.supplier?.id,
          warehouseId,
          branchId,
          supplierInvoiceNo: supplierInvoiceNo || undefined,
          lines: payload,
        },
      });
      setReceipt(result);
      setLines([]);
      setPoId("");
      setSupplierInvoiceNo("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ready =
    lines.length > 0 &&
    lines.every(
      (l) =>
        l.batchNumber &&
        l.expiryDate &&
        Number(l.quantity) > 0 &&
        l.unitCost !== "",
    ) &&
    !!selectedOrder?.supplier?.id;

  return (
    <Shell>
      <PageHeader
        title="Goods Receiving"
        subtitle="Scan the pack to capture batch and expiry. New batches land quarantined until QA releases them."
      />

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      {receipt && (
        <Card className="mb-4" title={`Receipt ${receipt.grnNo} posted`}>
          <p className="text-sm text-ink-muted">
            {receipt.items.length} line(s) received. Batches are QUARANTINED
            until a QA officer releases them.
          </p>
          <div className="mt-2 flex gap-2">
            <a
              className="btn-ghost"
              target="_blank"
              rel="noreferrer"
              href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/reports/documents/goods-receipt/${receipt.id}`}
            >
              Print GRN
            </a>
            <a className="btn-ghost" href="/batches?status=QUARANTINED">
              Go to quarantine
            </a>
          </div>
          {receipt.items.some((i: any) => i.flags?.length) && (
            <div className="mt-3 rounded-md bg-warn-light p-2 text-xs text-warn">
              Exceptions raised:
              <ul className="mt-1 list-inside list-disc">
                {receipt.items.flatMap((i: any) =>
                  (i.flags ?? []).map((f: string) => (
                    <li key={`${i.id}-${f}`}>
                      {i.batchNumber}: {f}
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Receive a delivery">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label">Against purchase order</label>
              <select
                aria-label="Against purchase order"
                className="input"
                value={poId}
                onChange={(e) => setPoId(e.target.value)}
              >
                <option value="">Select an ordered PO</option>
                {(orders.data ?? []).map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.poNo} — {o.supplier.companyName}
                    {o.expectedDate ? ` — due ${shortDate(o.expectedDate)}` : ""}
                    {o.overdue ? " (overdue)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Supplier invoice no.</label>
              <input
                aria-label="Supplier invoice no."
                className="input"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
              />
            </div>
          </div>

          <div className="my-4 border-t border-surface-border pt-3">
            <Scanner onResolved={applyScan} label="Scan delivery" />
          </div>

          {lines.length > 0 ? (
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div
                  key={l.key}
                  className="rounded-md border border-surface-border p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {l.productLabel}
                    </span>
                    <button
                      className="btn-ghost text-xs"
                      onClick={() =>
                        setLines((p) => p.filter((_, xi) => xi !== i))
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      ["Batch number", "batchNumber", "text"],
                      ["Expiry date", "expiryDate", "date"],
                      ["Manufactured", "manufacturingDate", "date"],
                      ["Quantity delivered", "quantity", "number"],
                      ["Unit cost", "unitCost", "number"],
                      ["Rejected quantity", "rejectedQty", "number"],
                    ].map(([label, field, type]) => (
                      <div key={field}>
                        <label className="label">{label}</label>
                        <input
                          aria-label={label as string}
                          type={type}
                          className="input"
                          value={(l as any)[field]}
                          onChange={(e) =>
                            setLines((p) =>
                              p.map((x, xi) =>
                                xi === i
                                  ? { ...x, [field as string]: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                    {Number(l.rejectedQty) > 0 && (
                      <div className="sm:col-span-3">
                        <label className="label">
                          Rejection reason (required)
                        </label>
                        <input
                          aria-label="Rejection reason (required)"
                          className="input"
                          value={l.rejectionReason}
                          onChange={(e) =>
                            setLines((p) =>
                              p.map((x, xi) =>
                                xi === i
                                  ? { ...x, rejectionReason: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                  {l.outstanding !== undefined && (
                    <p className="mt-1 text-xs text-ink-subtle">
                      {qty(l.outstanding)} still outstanding on the order
                    </p>
                  )}
                  {Number(l.rejectedQty) > 0 && (
                    <p className="mt-1 text-xs text-warn">
                      {qty(Number(l.quantity) - Number(l.rejectedQty))} will
                      enter stock; {qty(Number(l.rejectedQty))} rejected at the
                      door.
                    </p>
                  )}
                </div>
              ))}

              <button
                className="btn-primary"
                disabled={busy || !ready}
                onClick={submit}
              >
                {busy ? "Posting..." : "Post goods receipt"}
              </button>
              {!ready && (
                <p className="text-xs text-ink-subtle">
                  Every line needs a purchase order, batch number, expiry,
                  quantity and unit cost.
                </p>
              )}
            </div>
          ) : (
            <Empty>Select a purchase order or scan a pack to start.</Empty>
          )}
        </Card>

        <Card title="Recent receipts">
          {recent.loading && <Loading />}
          {recent.data?.data?.length ? (
            <Table head={["GRN", "When", "Lines", "Flags"]}>
              {recent.data.data.map((g: any) => (
                <tr key={g.id}>
                  <td className="td font-medium">{g.grnNo}</td>
                  <td className="td text-xs text-ink-muted">
                    {shortDate(g.receivedAt)}
                  </td>
                  <td className="td num">{g.items.length}</td>
                  <td className="td">
                    {g.items.some((i: any) => i.flags?.length) ? (
                      <Pill tone="warn">exceptions</Pill>
                    ) : (
                      <Pill tone="ok">clean</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !recent.loading && <Empty>No receipts in this warehouse yet.</Empty>
          )}
        </Card>
      </div>
    </Shell>
  );
}
