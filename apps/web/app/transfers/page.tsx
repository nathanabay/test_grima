"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api, qty, shortDate, tokenStore } from "@/lib/api";
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
import {
  Card as Panel,
  Drawer,
  EmptyState,
  Field,
} from "@/components/primitives";
import { DataTable } from "@/components/DataTable";
import { SeverityBadge } from "@/components/status";

const STATUS_TONE: Record<string, any> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "info",
  PICKING: "info",
  DISPATCHED: "warn",
  IN_TRANSIT: "warn",
  PARTIALLY_RECEIVED: "warn",
  RECEIVED: "ok",
  COMPLETED: "ok",
  CANCELLED: "neutral",
};

export default function TransfersPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState<any>(null);

  const list = usePaged<any>("/transfers", {
    filters: message ? `v=${encodeURIComponent(message)}` : "",
    pageSize: 25,
  });
  const overdue = useApi<any[]>("/transfers/overdue", [message]);
  const detail = useApi<any>(selectedId ? `/transfers/${selectedId}` : null, [
    selectedId,
    message,
  ]);

  async function act(path: string, body: any, label: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body });
      setMessage(`${label} at ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Stock Transfers"
        subtitle="Dispatch removes stock from the origin; receipt adds it at the destination. Nothing is invisible in between."
        action={
          <button
            className="btn-primary"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Cancel" : "New transfer"}
          </button>
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

      {(overdue.data?.length ?? 0) > 0 && (
        <Panel
          className="mb-4"
          title="Overdue in transit"
          description="Stock that left the origin and has not been received. Nobody can sell it and nobody has counted it, so a transfer that quietly stays in transit is either lost, stolen, or sitting in a receiving bay unrecorded."
        >
          <DataTable
            rows={overdue.data ?? []}
            getKey={(r: any) => r.id}
            pageSize={10}
            exportName="overdue-transfers"
            searchPlaceholder="Search transfer, warehouse or courier"
            rowTone={(r: any) =>
              r.severity === "CRITICAL" ? "danger" : "warn"
            }
            onRowClick={(r: any) => setSelectedId(r.id)}
            columns={[
              {
                key: "severity",
                label: "Severity",
                width: "7rem",
                value: (r: any) => r.daysLate,
                render: (r: any) => <SeverityBadge level={r.severity} />,
              },
              {
                key: "transferNo",
                label: "Transfer",
                value: (r: any) => r.transferNo,
              },
              {
                key: "route",
                label: "Route",
                value: (r: any) => `${r.fromWarehouse} to ${r.toWarehouse}`,
              },
              {
                key: "daysLate",
                label: "Days late",
                numeric: true,
                value: (r: any) => r.daysLate,
              },
              {
                key: "expected",
                label: "Expected",
                value: (r: any) => r.expectedArrival ?? "",
                render: (r: any) => (
                  <span
                    title={
                      r.expectedBasis === "STATED"
                        ? "Stated at dispatch"
                        : "Default transit allowance"
                    }
                  >
                    {r.expectedArrival
                      ? shortDate(r.expectedArrival)
                      : "not stated"}
                  </span>
                ),
              },
              {
                key: "quantity",
                label: "In transit",
                numeric: true,
                optional: true,
                value: (r: any) => Number(r.inTransitQuantity),
                render: (r: any) => qty(r.inTransitQuantity),
              },
              {
                key: "courier",
                label: "Courier",
                optional: true,
                value: (r: any) => r.vehicleOrCourier ?? "-",
              },
              {
                key: "tracking",
                label: "Tracking",
                optional: true,
                value: (r: any) => r.trackingNumber ?? "-",
              },
            ]}
          />
        </Panel>
      )}

      {creating && (
        <NewTransfer
          onDone={(t) => {
            setCreating(false);
            setSelectedId(t.id);
            setMessage(`Transfer ${t.transferNo} created.`);
          }}
          onError={setError}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          title={`${list.total.toLocaleString()} transfer${list.total === 1 ? "" : "s"}`}
        >
          {list.loading && <Loading />}
          {list.error && <ErrorBox message={list.error} />}
          {list.rows.length ? (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.rows.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === t.id ? "border-brand bg-brand-light" : "border-transparent hover:bg-surface-sunken"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.transferNo}</span>
                    <Pill tone={STATUS_TONE[t.status]}>
                      {t.status.replace(/_/g, " ")}
                    </Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {t.items.length} line(s)
                    {t.isRecallMovement && " · recall movement"}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No transfers yet.</Empty>
          )}
          <Pager
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={list.setPage}
            loading={list.loading}
            noun="transfer"
          />
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && (
            <Card>
              <Empty>Select a transfer.</Empty>
            </Card>
          )}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card
              title={
                <span>
                  {detail.data.transferNo}{" "}
                  <Pill tone={STATUS_TONE[detail.data.status]}>
                    {detail.data.status.replace(/_/g, " ")}
                  </Pill>
                </span>
              }
              action={
                <a
                  className="btn-ghost text-xs"
                  target="_blank"
                  rel="noreferrer"
                  href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/reports/documents/stock-transfer/${detail.data.id}`}
                >
                  Print note
                </a>
              }
            >
              <Table
                head={[
                  "Product",
                  "Batch",
                  "Requested",
                  "Dispatched",
                  "Received",
                  "Variance",
                ]}
              >
                {detail.data.items.map((i: any) => {
                  const variance =
                    Number(i.dispatchedQty) - Number(i.receivedQty);
                  return (
                    <tr key={i.id}>
                      <td className="td text-xs">{i.productId.slice(0, 8)}</td>
                      <td className="td text-xs text-ink-muted">
                        {i.batchId.slice(0, 8)}
                      </td>
                      <td className="td num">{qty(i.requestedQty)}</td>
                      <td className="td num">{qty(i.dispatchedQty)}</td>
                      <td className="td num">{qty(i.receivedQty)}</td>
                      <td
                        className={`td num ${variance > 0 ? "text-warn font-medium" : "text-ink-subtle"}`}
                      >
                        {variance > 0 ? `${qty(variance)} in transit` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </Table>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-border pt-3">
                {detail.data.status === "DRAFT" && (
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      act(
                        `/transfers/${detail.data.id}/submit`,
                        {},
                        "Submitted",
                      )
                    }
                  >
                    Submit
                  </button>
                )}
                {detail.data.status === "SUBMITTED" && (
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        `/transfers/${detail.data.id}/approve`,
                        {},
                        "Approved",
                      )
                    }
                  >
                    Approve
                  </button>
                )}
                {["APPROVED", "PICKING"].includes(detail.data.status) && (
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => setDispatching(detail.data)}
                  >
                    Dispatch...
                  </button>
                )}
                {["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(
                  detail.data.status,
                ) && (
                  <>
                    <button
                      className="btn-primary"
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/transfers/${detail.data.id}/receive`,
                          {
                            lines: detail.data.items
                              .map((i: any) => ({
                                itemId: i.id,
                                quantity:
                                  Number(i.dispatchedQty) -
                                  Number(i.receivedQty),
                              }))
                              .filter((l: any) => l.quantity > 0),
                          },
                          "Received in full",
                        )
                      }
                    >
                      Receive in full
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        const item = detail.data.items[0];
                        const inTransit =
                          Number(item.dispatchedQty) - Number(item.receivedQty);
                        const got = window.prompt(
                          `Quantity actually received of ${inTransit}:`,
                          String(inTransit),
                        );
                        if (!got) return;
                        const reason =
                          Number(got) < inTransit
                            ? window.prompt(
                                "Variance reason (required for a shortfall):",
                              )
                            : undefined;
                        if (Number(got) < inTransit && !reason) return;
                        act(
                          `/transfers/${detail.data.id}/receive`,
                          {
                            lines: [
                              {
                                itemId: item.id,
                                quantity: Number(got),
                                varianceReason: reason,
                              },
                            ],
                          },
                          "Partially received",
                        );
                      }}
                    >
                      Receive short
                    </button>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <DispatchDrawer
        transfer={dispatching}
        onClose={() => setDispatching(null)}
        onDispatched={(no) => {
          setDispatching(null);
          setMessage(`Transfer ${no} dispatched.`);
        }}
        onError={setError}
      />
    </Shell>
  );
}

function NewTransfer({
  onDone,
  onError,
}: {
  onDone: (t: any) => void;
  onError: (m: string) => void;
}) {
    // The reader's own branches and warehouses. Not `/admin/organization`, which
  // requires admin.branch.READ and therefore fails for every operational role.
  const org = useApi<any>("/auth/me/scope");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  // What the server actually returned, so a capped dropdown can say so.
  const [matches, setMatches] = useState<{ shown: number; total?: number }>({
    shown: 0,
  });
  const [lines, setLines] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const warehouses = (org.data?.branches ?? []).flatMap((b: any) =>
    b.warehouses.map((w: any) => ({ ...w, branchName: b.name })),
  );

  useEffect(() => {
    if (!search || !from) {
      setResults([]);
      setMatches({ shown: 0 });
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api<any>(
          `/inventory/balances?warehouseId=${from}&search=${encodeURIComponent(search)}&pageSize=15`,
        );
        setResults(r.data.filter((b: any) => b.batch && Number(b.onHand) > 0));
        setMatches({ shown: r.data.length, total: r.total });
      } catch (e: any) {
        onError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, from, onError]);

  return (
    <Card className="mb-4" title="New transfer">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">From warehouse</label>
          <select
            aria-label="From warehouse"
            className="input"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setLines([]);
            }}
          >
            <option value="">Select origin</option>
            {warehouses.map((w: any) => (
              <option key={w.id} value={w.id}>
                {w.branchName} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">To warehouse</label>
          <select
            aria-label="To warehouse"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Select destination</option>
            {warehouses
              .filter((w: any) => w.id !== from)
              .map((w: any) => (
                <option key={w.id} value={w.id}>
                  {w.branchName} — {w.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="label">Reason</label>
          <input
            aria-label="Reason"
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Redistribution before expiry"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Add stock from the origin</label>
        <input
          aria-label="Add stock from the origin"
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product"
          disabled={!from}
        />
        {results.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-surface-border">
            {results.map((b) => (
              <button
                key={b.id}
                className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                onClick={() => {
                  if (lines.some((l) => l.batchId === b.batch.id)) return;
                  setLines((p) => [
                    ...p,
                    {
                      productId: b.productId,
                      batchId: b.batch.id,
                      label: `${b.product.genericName} · ${b.batch.batchNumber}`,
                      available: Number(b.onHand),
                      quantity: "",
                    },
                  ]);
                  setSearch("");
                  setResults([]);
                }}
              >
                {b.product.genericName} {b.product.strength} ·{" "}
                {b.batch.batchNumber} · {qty(b.onHand)} available · exp{" "}
                {shortDate(b.batch.expiryDate)}
              </button>
            ))}
            <MoreMatches shown={matches.shown} total={matches.total} />
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <Table head={["Item", "Available", "Quantity", ""]}>
          {lines.map((l, i) => (
            <tr key={l.batchId}>
              <td className="td text-xs">{l.label}</td>
              <td className="td num">{qty(l.available)}</td>
              <td className="td">
                <input
                  className="input w-24 num"
                  type="number"
                  max={l.available}
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((p) =>
                      p.map((x, xi) =>
                        xi === i ? { ...x, quantity: e.target.value } : x,
                      ),
                    )
                  }
                />
              </td>
              <td className="td">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setLines((p) => p.filter((_, xi) => xi !== i))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <button
        className="btn-primary mt-3"
        disabled={
          busy ||
          !from ||
          !to ||
          !lines.length ||
          lines.some((l) => !Number(l.quantity))
        }
        onClick={async () => {
          setBusy(true);
          try {
            onDone(
              await api("/transfers", {
                method: "POST",
                body: {
                  fromWarehouseId: from,
                  toWarehouseId: to,
                  reason,
                  items: lines.map((l) => ({
                    productId: l.productId,
                    batchId: l.batchId,
                    quantity: Number(l.quantity),
                  })),
                },
              }),
            );
          } catch (e: any) {
            onError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating..." : "Create transfer"}
      </button>
    </Card>
  );
}

/**
 * Dispatch with the logistics detail the destination needs (§20).
 *
 * Courier, driver, tracking number and an expected arrival, because a transfer
 * with none of these cannot be chased when it goes missing. The expected
 * arrival is what makes the overdue list above possible at all; when it is left
 * blank the configured transit allowance is used instead.
 */
function DispatchDrawer({
  transfer,
  onClose,
  onDispatched,
  onError,
}: {
  transfer: any | null;
  onClose: () => void;
  onDispatched: (transferNo: string) => void;
  onError: (message: string) => void;
}) {
  const [vehicleOrCourier, setCourier] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [trackingNumber, setTracking] = useState("");
  const [expectedArrival, setExpected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCourier("");
    setDriverName("");
    setDriverPhone("");
    setTracking("");
    setExpected("");
  }, [transfer?.id]);

  if (!transfer) return null;

  const lines = transfer.items
    .map((i: any) => ({
      itemId: i.id,
      quantity: Number(i.requestedQty) - Number(i.dispatchedQty),
    }))
    .filter((l: any) => l.quantity > 0);

  async function dispatch() {
    setBusy(true);
    try {
      await api(`/transfers/${transfer.id}/dispatch`, {
        method: "POST",
        body: {
          lines,
          vehicleOrCourier: vehicleOrCourier || undefined,
          driverName: driverName || undefined,
          driverPhone: driverPhone || undefined,
          trackingNumber: trackingNumber || undefined,
          expectedArrival: expectedArrival
            ? new Date(expectedArrival).toISOString()
            : undefined,
        },
      });
      onDispatched(transfer.transferNo);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Dispatch ${transfer.transferNo}`}
      description={`${lines.length} line(s) will leave the origin warehouse now.`}
    >
      {lines.length === 0 ? (
        <EmptyState
          title="Nothing left to dispatch"
          body="Every line on this transfer has already been sent."
        />
      ) : (
        <div className="space-y-3">
          <Field label="Courier or vehicle">
            <input
              className="input"
              value={vehicleOrCourier}
              onChange={(e) => setCourier(e.target.value)}
            />
          </Field>
          <Field label="Driver name">
            <input
              className="input"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
            />
          </Field>
          <Field
            label="Driver phone"
            hint="Held on the transfer so the destination can chase the delivery. It is not copied into the audit log."
          >
            <input
              className="input"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
            />
          </Field>
          <Field label="Tracking number">
            <input
              className="input"
              value={trackingNumber}
              onChange={(e) => setTracking(e.target.value)}
            />
          </Field>
          <Field
            label="Expected arrival"
            hint="Leave blank to use the configured transit allowance. Either way the transfer appears on the overdue list once it is late."
          >
            <input
              className="input"
              type="datetime-local"
              value={expectedArrival}
              onChange={(e) => setExpected(e.target.value)}
            />
          </Field>

          <button
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={dispatch}
          >
            {busy ? "Dispatching…" : `Dispatch ${lines.length} line(s)`}
          </button>
        </div>
      )}
    </Drawer>
  );
}
