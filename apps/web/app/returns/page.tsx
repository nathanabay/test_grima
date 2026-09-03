"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, qty, shortDate, tokenStore } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";

const DISPOSITIONS = ["RESTOCK", "QUARANTINE", "RETURN_SUPPLIER", "DESTROY"];

export default function ReturnsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, string>>({});

  const list = useApi<any>("/returns?pageSize=25", [message]);
  const detail = useApi<any>(selectedId ? `/returns/${selectedId}` : null, [
    selectedId,
    message,
  ]);

  async function inspect() {
    const items = detail.data.items;
    const chosen = items.map((i: any) => ({
      itemId: i.id,
      disposition: decisions[i.id] ?? "QUARANTINE",
      notes: undefined,
    }));
    setBusy(true);
    setError(null);
    try {
      await api(`/returns/${selectedId}/inspect`, {
        method: "POST",
        body: { decisions: chosen },
      });
      setMessage("Inspection recorded; dispositions applied to stock.");
      setDecisions({});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Returns"
        subtitle="Returned medicine comes back quarantined and never re-enters sellable stock without an inspection decision."
        action={
          <button
            className="btn-primary"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Cancel" : "Record return"}
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

      {creating && (
        <NewReturn
          onDone={(r) => {
            setCreating(false);
            setSelectedId(r.id);
            setMessage(
              `Return ${r.returnNo} recorded — stock quarantined pending inspection.`,
            );
          }}
          onError={setError}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          title={`${list.data?.total ?? 0} returns`}
        >
          {list.loading && <Loading />}
          {list.data?.data?.length ? (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.data.data.map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === r.id ? "border-brand bg-brand-light" : "border-transparent hover:bg-surface-sunken"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.returnNo}</span>
                    <Pill tone={r.status === "CLOSED" ? "ok" : "warn"}>
                      {r.status}
                    </Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {r.type} · {r.items.length} line(s) ·{" "}
                    {shortDate(r.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No returns recorded.</Empty>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && (
            <Card>
              <Empty>Select a return.</Empty>
            </Card>
          )}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card
              title={`${detail.data.returnNo} — ${detail.data.type}`}
              action={
                <a
                  className="btn-ghost text-xs"
                  target="_blank"
                  rel="noreferrer"
                  href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/reports/documents/return-note/${detail.data.id}`}
                >
                  Print note
                </a>
              }
            >
              <p className="mb-3 text-sm text-ink-muted">
                {detail.data.reason}
              </p>
              <Table head={["Batch", "Quantity", "Condition", "Disposition"]}>
                {detail.data.items.map((i: any) => (
                  <tr key={i.id}>
                    <td className="td text-xs">{i.batchId.slice(0, 8)}</td>
                    <td className="td num">{qty(i.quantity)}</td>
                    <td className="td text-xs text-ink-muted">
                      {i.condition ?? "-"}
                    </td>
                    <td className="td">
                      {detail.data.status === "CLOSED" ? (
                        <Pill
                          tone={
                            i.disposition === "RESTOCK"
                              ? "ok"
                              : i.disposition === "DESTROY"
                                ? "danger"
                                : "warn"
                          }
                        >
                          {i.disposition.replace(/_/g, " ")}
                        </Pill>
                      ) : (
                        <select
                          className="input text-xs"
                          value={decisions[i.id] ?? "QUARANTINE"}
                          onChange={(e) =>
                            setDecisions((p) => ({
                              ...p,
                              [i.id]: e.target.value,
                            }))
                          }
                        >
                          {DISPOSITIONS.map((d) => (
                            <option key={d} value={d}>
                              {d.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>

              {detail.data.status !== "CLOSED" && (
                <div className="mt-3 border-t border-surface-border pt-3">
                  <p className="mb-2 text-xs text-ink-subtle">
                    RESTOCK releases the batch back to sellable stock. DESTROY
                    and RETURN SUPPLIER move it out. An expired batch can never
                    be restocked.
                  </p>
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={inspect}
                  >
                    Record inspection
                  </button>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}

function NewReturn({
  onDone,
  onError,
}: {
  onDone: (r: any) => void;
  onError: (m: string) => void;
}) {
    // The reader's own branches and warehouses. Not `/admin/organization`, which
  // requires admin.branch.READ and therefore fails for every operational role.
  const org = useApi<any>("/auth/me/scope");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [type, setType] = useState("CUSTOMER");
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
      setWarehouseId(
        first.warehouses.find((w: any) => !w.isColdRoom)?.id ?? "",
      );
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

  const branch = org.data?.branches.find((b: any) => b.id === branchId);

  return (
    <Card className="mb-4" title="Record a return">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Type</label>
          <select
            aria-label="Type"
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {["CUSTOMER", "SUPPLIER", "BRANCH"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Branch</label>
          <select
            aria-label="Branch"
            className="input"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              const b = org.data?.branches.find(
                (x: any) => x.id === e.target.value,
              );
              setWarehouseId(b?.warehouses[0]?.id ?? "");
            }}
          >
            {(org.data?.branches ?? []).map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
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
            {(branch?.warehouses ?? []).map((w: any) => (
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
            placeholder="Why is it coming back?"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Which batch</label>
        <input
          aria-label="Which batch"
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
                      quantity: "",
                      condition: "SEALED",
                    },
                  ]);
                  setSearch("");
                  setResults([]);
                }}
              >
                {b.product.genericName} {b.product.strength} ·{" "}
                {b.batch.batchNumber}
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <Table head={["Item", "Quantity", "Condition", ""]}>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="td text-xs">{l.label}</td>
              <td className="td">
                <input
                  className="input w-24 num"
                  type="number"
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
                <select
                  className="input text-xs"
                  value={l.condition}
                  onChange={(e) =>
                    setLines((p) =>
                      p.map((x, xi) =>
                        xi === i ? { ...x, condition: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {[
                    "SEALED",
                    "OPENED",
                    "DAMAGED",
                    "TEMPERATURE_COMPROMISED",
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
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
              await api("/returns", {
                method: "POST",
                body: {
                  type,
                  branchId,
                  warehouseId,
                  reason,
                  items: lines.map((l) => ({
                    productId: l.productId,
                    batchId: l.batchId,
                    quantity: Number(l.quantity),
                    condition: l.condition,
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
        {busy ? "Recording..." : "Record return"}
      </button>
    </Card>
  );
}
