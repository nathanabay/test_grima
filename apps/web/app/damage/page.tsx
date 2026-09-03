"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, money, qty, shortDate, tokenStore } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";

const DAMAGE_TYPES = [
  "BREAKAGE",
  "CONTAMINATION",
  "PACKAGING",
  "HANDLING",
  "TEMPERATURE",
  "PEST",
  "OTHER",
];

const STATUS_TONE: Record<string, any> = {
  REPORTED: "warn",
  VERIFIED: "info",
  REJECTED: "neutral",
  DISPOSED: "ok",
};

export default function DamagePage() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useApi<any>("/damage-reports?pageSize=25", [message]);
  const summary = useApi<any>("/damage-reports/summary?days=90", [message]);

  async function verify(id: string, decision: "VERIFY" | "REJECT") {
    const notes =
      decision === "REJECT"
        ? window.prompt(
            "Why is this being rejected? The stock will be returned to inventory:",
          )
        : (window.prompt("Verification notes (optional):") ?? undefined);
    if (decision === "REJECT" && !notes) return;

    setBusy(true);
    setError(null);
    try {
      await api(`/damage-reports/${id}/verify`, {
        method: "POST",
        body: { decision, notes },
      });
      setMessage(
        decision === "VERIFY"
          ? "Damage verified; held for disposal."
          : "Damage rejected; stock returned to inventory.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Damaged Stock"
        subtitle="Reporting damage removes those units from sellable inventory immediately. The write-off stays in the ledger permanently."
        action={
          <button
            className="btn-primary"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Cancel" : "Report damage"}
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

      {summary.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card p-3">
            <div className="text-xs text-ink-muted">Reports (90 days)</div>
            <div className="text-lg font-semibold num">
              {summary.data.reports}
            </div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-ink-muted">Units written off</div>
            <div className="text-lg font-semibold num">
              {qty(summary.data.totalUnits)}
            </div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-ink-muted">Value lost</div>
            <div className="text-lg font-semibold num text-danger">
              {money(summary.data.totalValue)}
            </div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-ink-muted">Awaiting verification</div>
            <div className="text-lg font-semibold num">
              {summary.data.awaitingVerification}
            </div>
          </div>
        </div>
      )}

      {creating && (
        <ReportDamage
          onDone={(r) => {
            setCreating(false);
            setMessage(
              `Damage report ${r.reportNo} raised; ${qty(r.quantity)} unit(s) removed from stock.`,
            );
          }}
          onError={setError}
        />
      )}

      <Card title={`${list.data?.total ?? 0} damage reports`}>
        {list.loading && <Loading />}
        {list.data?.data?.length ? (
          <Table
            head={[
              "Report",
              "Product",
              "Batch",
              "Cause",
              "Quantity",
              "Value",
              "Status",
              "",
            ]}
          >
            {list.data.data.map((r: any) => (
              <tr key={r.id}>
                <td className="td font-medium">
                  {r.reportNo}
                  <div className="text-xs text-ink-subtle">
                    {shortDate(r.createdAt)}
                  </div>
                </td>
                <td className="td">
                  {r.product
                    ? `${r.product.genericName} ${r.product.strength}`
                    : "-"}
                </td>
                <td className="td text-xs text-ink-muted">
                  {r.batchNumber ?? "-"}
                </td>
                <td className="td text-xs">
                  {r.damageType}
                  <div className="text-xs text-ink-subtle">
                    {r.reason.slice(0, 40)}
                  </div>
                </td>
                <td className="td num">{qty(r.quantity)}</td>
                <td className="td num">{money(r.totalValue)}</td>
                <td className="td">
                  <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                </td>
                <td className="td">
                  {r.status === "REPORTED" && (
                    <div className="flex gap-1">
                      <button
                        className="btn-primary text-xs"
                        disabled={busy}
                        onClick={() => verify(r.id, "VERIFY")}
                      >
                        Verify
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => verify(r.id, "REJECT")}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          !list.loading && <Empty>No damage reported.</Empty>
        )}
      </Card>
    </Shell>
  );
}

function ReportDamage({
  onDone,
  onError,
}: {
  onDone: (r: any) => void;
  onError: (m: string) => void;
}) {
    // The reader's own branches and warehouses. Not `/admin/organization`, which
  // requires admin.branch.READ and therefore fails for every operational role.
  const org = useApi<any>("/auth/me/scope");
  const [warehouseId, setWarehouseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [picked, setPicked] = useState<any>(null);
  const [quantity, setQuantity] = useState("");
  const [damageType, setDamageType] = useState(DAMAGE_TYPES[0]);
  const [reason, setReason] = useState("");
  const [raiseIncident, setRaiseIncident] = useState(false);
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
        setResults(r.data.filter((b: any) => b.batch && Number(b.onHand) > 0));
      } catch (e: any) {
        onError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, warehouseId, onError]);

  return (
    <Card className="mb-4" title="Report damaged stock">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Warehouse</label>
          <select
            aria-label="Warehouse"
            className="input"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setPicked(null);
            }}
          >
            {(org.data?.branches ?? []).flatMap((b: any) =>
              b.warehouses.map((w: any) => (
                <option key={w.id} value={w.id}>
                  {b.name} — {w.name}
                </option>
              )),
            )}
          </select>
        </div>
        <div>
          <label className="label">Cause</label>
          <select
            aria-label="Cause"
            className="input"
            value={damageType}
            onChange={(e) => setDamageType(e.target.value)}
          >
            {DAMAGE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Damaged quantity</label>
          <input
            aria-label="Damaged quantity"
            className="input num"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={!picked}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Which batch</label>
        {picked ? (
          <div className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2 text-sm">
            <span>
              {picked.label} — {qty(picked.onHand)} on hand
            </span>
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                setPicked(null);
                setQuantity("");
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
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
                      setPicked({
                        productId: b.productId,
                        batchId: b.batch.id,
                        onHand: Number(b.onHand),
                        label: `${b.product.genericName} ${b.product.strength} · ${b.batch.batchNumber}`,
                      });
                      setSearch("");
                      setResults([]);
                    }}
                  >
                    {b.product.genericName} {b.product.strength} ·{" "}
                    {b.batch.batchNumber} · {qty(b.onHand)} on hand
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-3">
        <label className="label">What happened</label>
        <textarea
          aria-label="What happened"
          className="input"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Carton crushed by a pallet during unloading"
        />
      </div>

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={raiseIncident}
          onChange={(e) => setRaiseIncident(e.target.checked)}
        />
        Also raise a quality incident (use when a supplier or process is at
        fault)
      </label>

      <button
        className="btn-primary mt-3"
        disabled={busy || !picked || !Number(quantity) || !reason.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            onDone(
              await api("/damage-reports", {
                method: "POST",
                body: {
                  productId: picked.productId,
                  batchId: picked.batchId,
                  warehouseId,
                  branchId,
                  quantity: Number(quantity),
                  damageType,
                  reason,
                  raiseIncident,
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
        {busy ? "Reporting..." : "Report damage"}
      </button>
      <p className="mt-1 text-xs text-ink-subtle">
        The units leave sellable stock as soon as this is submitted. A QA
        officer then verifies — rejecting a report returns them.
      </p>
    </Card>
  );
}
