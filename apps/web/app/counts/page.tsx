"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api, can, money, qty, tokenStore } from "@/lib/api";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pager,
  Pill,
  Table,
} from "@/components/ui";

const COUNT_TYPES = [
  {
    value: "WAREHOUSE",
    label: "Whole warehouse",
    hint: "Every position in the selected warehouse",
  },
  {
    value: "FULL",
    label: "Full inventory",
    hint: "Every position across the branch",
  },
  { value: "CATEGORY", label: "By category", hint: "One therapeutic category" },
  { value: "BIN", label: "Single bin", hint: "One storage location" },
  {
    value: "CYCLE",
    label: "Cycle count",
    hint: "The positions counted longest ago",
  },
  {
    value: "RANDOM",
    label: "Random spot check",
    hint: "An unbiased random sample",
  },
];

export default function CountsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canCount = can(user, "inventory.count.CREATE");

  const list = usePaged<any>("/stock-counts", { pageSize: 25 });
  const detail = useApi<any>(
    selectedId ? `/stock-counts/${selectedId}` : null,
    [selectedId],
  );

  return (
    <Shell>
      <PageHeader
        title="Physical Stock Counts"
        subtitle="Counting never writes stock directly — posting a count produces adjustment movements, so every discrepancy stays in the ledger."
        action={
          canCount && (
            <button
              className="btn-primary"
              onClick={() => setCreating((v) => !v)}
            >
              {creating ? "Cancel" : "New count"}
            </button>
          )
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
        <NewCount
          onCreated={(count) => {
            setCreating(false);
            setSelectedId(count.id);
            list.refresh();
            setMessage(
              `Count ${count.countNo} opened with ${count.items.length} line(s).`,
            );
          }}
          onError={setError}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          title={`${list.total.toLocaleString()} ${list.total === 1 ? "count" : "counts"}`}
        >
          {list.loading && <Loading />}
          {list.rows.length ? (
            <div className="space-y-1">
              {list.rows.map((c: any) => {
                const counted = c.items.filter(
                  (i: any) => i.countedQty !== null,
                ).length;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full rounded-md border p-2 text-left text-sm ${
                      selectedId === c.id
                        ? "border-brand bg-brand-light"
                        : "border-transparent hover:bg-surface-sunken"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{c.countNo}</span>
                      <Pill
                        tone={
                          c.status === "CLOSED"
                            ? "ok"
                            : c.status === "SUBMITTED"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {c.status}
                      </Pill>
                    </div>
                    <div className="text-xs text-ink-subtle">
                      {c.countType} · {counted}/{c.items.length} counted
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            !list.loading && <Empty>No counts yet.</Empty>
          )}
          <Pager
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={list.setPage}
            loading={list.loading}
            noun="count"
          />
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && (
            <Card>
              <Empty>Select or open a count.</Empty>
            </Card>
          )}
          {detail.loading && <Loading />}
          {detail.data && (
            <CountSheet
              count={detail.data}
              onChanged={() => {
                detail.refresh();
                list.refresh();
              }}
              onError={setError}
              onMessage={setMessage}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

function NewCount({
  onCreated,
  onError,
}: {
  onCreated: (c: any) => void;
  onError: (m: string) => void;
}) {
  const [countType, setCountType] = useState("WAREHOUSE");
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [sampleSize, setSampleSize] = useState(25);
  const [isBlind, setIsBlind] = useState(false);
  const [freeze, setFreeze] = useState(false);
  const [busy, setBusy] = useState(false);

    // The reader's own branches and warehouses. Not `/admin/organization`, which
  // requires admin.branch.READ and therefore fails for every operational role.
  const org = useApi<any>("/auth/me/scope");

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
      setWarehouseId(first.warehouses[0]?.id ?? "");
    }
  }, [org.data]);

  const branch = branches.find((b) => b.id === branchId);
  const warehouse = (branch?.warehouses ?? []).find((w: any) => w.id === warehouseId);
  const chosen = COUNT_TYPES.find((t) => t.value === countType);

  async function submit() {
    setBusy(true);
    try {
      onCreated(
        await api("/stock-counts", {
          method: "POST",
          body: {
            warehouseId,
            branchId,
            countType,
            categoryId: countType === "CATEGORY" ? categoryId : undefined,
            locationId: countType === "BIN" ? locationId : undefined,
            sampleSize: ["CYCLE", "RANDOM"].includes(countType)
              ? sampleSize
              : undefined,
            isBlind,
            freeze,
          },
        }),
      );
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4" title="Open a count">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Type</label>
          <select
            aria-label="Type"
            className="input"
            value={countType}
            onChange={(e) => setCountType(e.target.value)}
          >
            {COUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-subtle">{chosen?.hint}</p>
        </div>

        <div>
          <label className="label">Branch</label>
          <select
            aria-label="Branch"
            className="input"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              const b = branches.find((x) => x.id === e.target.value);
              setWarehouseId(b?.warehouses[0]?.id ?? "");
            }}
          >
            {branches.map((b) => (
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

        {countType === "CATEGORY" && (
          <CategoryPicker value={categoryId} onChange={setCategoryId} />
        )}

        {countType === "BIN" && (
          <div>
            <label className="label">Location</label>
            <select
              aria-label="Location"
              className="input"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Select a bin</option>
              {(warehouse?.locations ?? [])
                .filter((l: any) => l.level === "BIN")
                .map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {["CYCLE", "RANDOM"].includes(countType) && (
          <div>
            <label className="label">Sample size</label>
            <input
              aria-label="Sample size"
              type="number"
              min={1}
              max={500}
              className="input num"
              value={sampleSize}
              onChange={(e) => setSampleSize(Number(e.target.value))}
            />
          </div>
        )}

        <div className="sm:col-span-2 lg:col-span-3">
          <fieldset className="rounded-card border border-border p-3">
            <legend className="px-1 text-caption uppercase text-ink-muted">
              How the count is run
            </legend>
            <label className="flex items-start gap-2 text-small">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={isBlind}
                onChange={(e) => setIsBlind(e.target.checked)}
              />
              <span>
                <span className="text-ink">Blind count</span>
                <span className="block text-caption text-ink-subtle">
                  The counter does not see what the system expects. The figures
                  are masked on the server, not merely hidden here, and are
                  revealed once the sheet is submitted or to a supervisor who
                  has to judge the variance.
                </span>
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-small">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={freeze}
                onChange={(e) => setFreeze(e.target.checked)}
              />
              <span>
                <span className="text-ink">Freeze the counted stock</span>
                <span className="block text-caption text-ink-subtle">
                  No movement may touch these positions until the count is
                  posted or unfrozen, so the number written on the sheet is
                  still true when it is keyed in. Selling and dispensing
                  elsewhere in the warehouse is unaffected.
                </span>
              </span>
            </label>
          </fieldset>
        </div>

        <div className="flex items-end">
          <button
            className="btn-primary w-full"
            disabled={
              busy ||
              !warehouseId ||
              (countType === "CATEGORY" && !categoryId) ||
              (countType === "BIN" && !locationId)
            }
            onClick={submit}
          >
            {busy ? "Opening..." : "Open count"}
          </button>
        </div>
      </div>
    </Card>
  );
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // The categories table, not the categories that happen to appear in the
  // first page of products — which silently omitted any category whose
  // products all sorted later.
  const { data } = useApi<any[]>("/products/categories");
  return (
    <div>
      <label className="label">Category</label>
      <select
        aria-label="Category"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a category</option>
        {(data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function CountSheet({
  count,
  onChanged,
  onError,
  onMessage,
}: {
  count: any;
  onChanged: () => void;
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [scanCode, setScanCode] = useState("");
  const [scanQty, setScanQty] = useState("");
  const [busy, setBusy] = useState(false);

  const closed = count.status === "CLOSED";
  const counted = count.items.filter((i: any) => i.countedQty !== null).length;

  async function toggleFreeze() {
    setBusy(true);
    try {
      await api(`/stock-counts/${count.id}/freeze`, {
        method: "POST",
        body: { freeze: !count.isFrozen },
      });
      onChanged();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    setBusy(true);
    onError("");
    try {
      const lines = Object.entries(entries)
        .filter(([, v]) => v !== "")
        .map(([itemId, v]) => ({
          itemId,
          countedQty: Number(v),
          reason: reasons[itemId],
        }));
      if (!lines.length) return;
      await api(`/stock-counts/${count.id}/record`, {
        method: "POST",
        body: { lines },
      });
      setEntries({});
      onChanged();
      onMessage(`${lines.length} line(s) recorded.`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function scanLine() {
    setBusy(true);
    onError("");
    try {
      await api(`/stock-counts/${count.id}/scan`, {
        method: "POST",
        body: { code: scanCode, countedQty: Number(scanQty) },
      });
      setScanCode("");
      setScanQty("");
      onChanged();
      onMessage("Counted line recorded from scan.");
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (
      !window.confirm(
        "Posting writes adjustment movements to the ledger for every variance. Continue?",
      )
    )
      return;
    setBusy(true);
    onError("");
    try {
      await api(`/stock-counts/${count.id}/post`, { method: "POST" });
      onChanged();
      onMessage(
        `Count ${count.countNo} posted; variances written to the ledger.`,
      );
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={
        <span>
          {count.countNo}
          <span className="ml-2 text-xs font-normal text-ink-subtle">
            {count.countType} · {counted}/{count.items.length} counted
          </span>
        </span>
      }
      action={
        !closed && (
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => void toggleFreeze()}
            >
              {count.isFrozen ? "Unfreeze stock" : "Freeze stock"}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={saveAll}>
              Save entries
            </button>
            <button
              className="btn-primary"
              disabled={busy || counted < count.items.length}
              onClick={post}
            >
              Post count
            </button>
          </div>
        )
      }
    >
      {count.isFrozen && (
        <div className="mb-3 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-info">
          Stock on this count is frozen. Any movement touching a counted
          position is refused until the count is posted or unfrozen.
        </div>
      )}
      {count.blindMasked && (
        <div className="mb-3 rounded-md border border-warn/30 bg-warn-light px-3 py-2 text-sm text-warn">
          Blind count: the expected quantities are withheld until the sheet is
          submitted. Record what is physically on the shelf.
        </div>
      )}

      {!closed && (
        <div className="mb-4 rounded-md border border-dashed border-surface-border p-3">
          <label className="label">Count by scanning (§21)</label>
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1 min-w-[200px]"
              placeholder="Scan the pack — GS1 DataMatrix identifies the batch"
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => {
                // A wedge scanner sends Enter after the code; move to quantity.
                if (e.key === "Enter") {
                  e.preventDefault();
                  (
                    document.getElementById("scan-qty") as HTMLInputElement
                  )?.focus();
                }
              }}
            />
            <input
              id="scan-qty"
              className="input w-28 num"
              type="number"
              placeholder="Counted"
              value={scanQty}
              onChange={(e) => setScanQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && scanCode && scanQty) {
                  e.preventDefault();
                  void scanLine();
                }
              }}
            />
            <button
              className="btn-ghost"
              disabled={busy || !scanCode || !scanQty}
              onClick={scanLine}
            >
              Record
            </button>
          </div>
        </div>
      )}

      <Table
        head={[
          "Product",
          "Batch",
          "System",
          "Counted",
          "Variance",
          "Value",
          "Reason",
        ]}
      >
        {count.items.map((i: any) => {
          const variance = Number(i.varianceQty);
          const entered =
            entries[i.id] ??
            (i.countedQty !== null ? String(i.countedQty) : "");
          return (
            <tr
              key={i.id}
              className={i.requiresApproval ? "bg-warn-light" : ""}
            >
              <td className="td text-xs">{i.productId.slice(0, 8)}</td>
              <td className="td text-xs text-ink-muted">
                {i.batchId ? i.batchId.slice(0, 8) : "-"}
              </td>
              <td className="td num">
                {i.systemQty === null ? (
                  <span className="text-ink-subtle">hidden</span>
                ) : (
                  qty(i.systemQty)
                )}
              </td>
              <td className="td">
                {closed ? (
                  <span className="num">
                    {i.countedQty !== null ? qty(i.countedQty) : "-"}
                  </span>
                ) : (
                  <input
                    className="input w-24 num"
                    type="number"
                    value={entered}
                    onChange={(e) =>
                      setEntries((p) => ({ ...p, [i.id]: e.target.value }))
                    }
                  />
                )}
              </td>
              <td
                className={`td num ${variance !== 0 ? "font-medium text-danger" : "text-ink-subtle"}`}
              >
                {i.countedQty !== null ? qty(variance) : "-"}
              </td>
              <td className="td num">
                {i.countedQty !== null ? money(i.varianceValue) : "-"}
              </td>
              <td className="td">
                {i.requiresApproval && !closed ? (
                  <input
                    className="input text-xs"
                    placeholder="Explanation required"
                    value={reasons[i.id] ?? i.reason ?? ""}
                    onChange={(e) =>
                      setReasons((p) => ({ ...p, [i.id]: e.target.value }))
                    }
                  />
                ) : (
                  <span className="text-xs text-ink-muted">
                    {i.reason ?? ""}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </Table>

      {count.items.some((i: any) => i.requiresApproval) && (
        <p className="mt-3 text-xs text-warn">
          Highlighted lines exceed the variance threshold: they need a written
          explanation and supervisor approval before the count can be posted.
        </p>
      )}
    </Card>
  );
}
