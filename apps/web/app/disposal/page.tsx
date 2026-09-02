"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, money, qty, shortDate, tokenStore } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";

const METHODS = [
  "INCINERATION",
  "RETURN_TO_SUPPLIER",
  "LICENSED_WASTE_CONTRACTOR",
  "ENCAPSULATION",
  "LANDFILL_AUTHORIZED",
];

export default function DisposalPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useApi<any>("/disposals?pageSize=25", [message]);
  const expired = useApi<any>("/inventory/expiry?maxDays=0", [message]);

  const selected = list.data?.data?.find((d: any) => d.id === selectedId);

  async function act(path: string, body: any, label: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body });
      setMessage(label);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Waste & Disposal"
        subtitle="Identify, approve, dispose, then record the certificate. The historical transactions are never deleted."
        action={
          <button
            className="btn-primary"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Cancel" : "New disposal"}
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

      {expired.data?.rows?.length > 0 && (
        <Card
          className="mb-4"
          title={`${expired.data.rows.length} expired position(s) awaiting disposal`}
        >
          <Table
            head={[
              "Product",
              "Batch",
              "Expired",
              "Quantity",
              "Write-off value",
            ]}
          >
            {expired.data.rows.slice(0, 10).map((r: any, i: number) => (
              <tr key={i}>
                <td className="td">{r.productName}</td>
                <td className="td text-ink-muted">{r.batchNumber}</td>
                <td className="td text-danger">{shortDate(r.expiryDate)}</td>
                <td className="td num">{qty(r.quantity)}</td>
                <td className="td num">{money(r.potentialLoss)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {creating && (
        <NewDisposal
          onDone={(d) => {
            setCreating(false);
            setSelectedId(d.id);
            setMessage(
              `Disposal ${d.disposalNo} raised; it needs approval before stock moves.`,
            );
          }}
          onError={setError}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          title={`${list.data?.total ?? 0} disposals`}
        >
          {list.loading && <Loading />}
          {list.data?.data?.length ? (
            <div className="max-h-[50vh] space-y-1 overflow-y-auto">
              {list.data.data.map((d: any) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === d.id ? "border-brand bg-brand-light" : "border-transparent hover:bg-surface-sunken"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{d.disposalNo}</span>
                    <Pill
                      tone={
                        d.status === "CLOSED"
                          ? "ok"
                          : d.status === "APPROVED"
                            ? "info"
                            : "warn"
                      }
                    >
                      {d.status}
                    </Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {d.method.replace(/_/g, " ")} · {money(d.totalCostValue)}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No disposals recorded.</Empty>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!selected && (
            <Card>
              <Empty>Select a disposal.</Empty>
            </Card>
          )}
          {selected && (
            <Card
              title={`${selected.disposalNo} — ${selected.method.replace(/_/g, " ")}`}
              action={
                selected.status === "CLOSED" && (
                  <a
                    className="btn-ghost text-xs"
                    target="_blank"
                    rel="noreferrer"
                    href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/reports/documents/disposal-certificate/${selected.id}`}
                  >
                    Print certificate
                  </a>
                )
              }
            >
              <p className="mb-3 text-sm text-ink-muted">{selected.reason}</p>
              <Table head={["Batch", "Quantity", "Unit cost", "Value"]}>
                {selected.items.map((i: any) => (
                  <tr key={i.id}>
                    <td className="td text-xs">{i.batchId.slice(0, 8)}</td>
                    <td className="td num">{qty(i.quantity)}</td>
                    <td className="td num">{money(i.unitCost)}</td>
                    <td className="td num">
                      {money(Number(i.quantity) * Number(i.unitCost))}
                    </td>
                  </tr>
                ))}
              </Table>
              <div className="mt-2 text-right text-sm font-semibold num">
                Total {money(selected.totalCostValue)}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-border pt-3">
                {selected.status === "SUBMITTED" && (
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        `/disposals/${selected.id}/approve`,
                        {},
                        "Disposal approved.",
                      )
                    }
                  >
                    Approve disposal
                  </button>
                )}
                {selected.status === "APPROVED" && (
                  <button
                    className="btn-danger"
                    disabled={busy}
                    onClick={() => {
                      const witness = window.prompt("Witness name (required):");
                      if (!witness) return;
                      const cert = window.prompt(
                        "Disposal certificate number (required):",
                      );
                      if (!cert) return;
                      act(
                        `/disposals/${selected.id}/execute`,
                        { witnessName: witness, certificateNo: cert },
                        "Disposal carried out; stock removed and certificate recorded.",
                      );
                    }}
                  >
                    Carry out disposal
                  </button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}

function NewDisposal({
  onDone,
  onError,
}: {
  onDone: (d: any) => void;
  onError: (m: string) => void;
}) {
  const org = useApi<any>("/admin/organization");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [method, setMethod] = useState(METHODS[0]);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org.data) return;
    const user = tokenStore.user;
    const allowed = user?.branchIds.length
      ? org.data.branches.filter((b: any) => user.branchIds.includes(b.id))
      : org.data.branches;
    const first = allowed[0];
    if (first) {
      setBranchId(first.id);
      setWarehouseId(first.warehouses[0]?.id ?? "");
    }
  }, [org.data]);

  useEffect(() => {
    if (!search || !warehouseId) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api<any>(
          `/inventory/balances?warehouseId=${warehouseId}&search=${encodeURIComponent(search)}&pageSize=15`,
        );
        setResults(r.data.filter((b: any) => b.batch));
      } catch (e: any) {
        onError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, warehouseId, onError]);

  return (
    <Card className="mb-4" title="Raise a disposal">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Method</label>
          <select
            aria-label="Method"
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Warehouse</label>
          <select
            aria-label="Warehouse"
            className="input"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {(org.data?.branches ?? [])
              .flatMap((b: any) => b.warehouses)
              .map((w: any) => (
                <option key={w.id} value={w.id}>
                  {w.name}
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
            placeholder="e.g. Expired stock, quarterly disposal"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Stock to dispose of</label>
        <input
          aria-label="Stock to dispose of"
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product"
        />
        {results.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-surface-border">
            {results.map((b) => (
              <button
                key={b.id}
                className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                onClick={() => {
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
                {b.product.genericName} · {b.batch.batchNumber} ·{" "}
                {qty(b.onHand)} on hand · {b.batch.status}
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <Table head={["Item", "On hand", "Quantity", ""]}>
          {lines.map((l, i) => (
            <tr key={i}>
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
        disabled={busy || !reason.trim() || !lines.length}
        onClick={async () => {
          setBusy(true);
          try {
            onDone(
              await api("/disposals", {
                method: "POST",
                body: {
                  branchId,
                  warehouseId,
                  method,
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
        {busy ? "Raising..." : "Raise disposal"}
      </button>
    </Card>
  );
}
