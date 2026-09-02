"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, qty, shortDate } from "@/lib/api";
import {
  BarChart,
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pill,
  Stat,
} from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { useFeedback } from "@/components/Feedback";

type Tab = "occupancy" | "tasks" | "waves" | "packages" | "productivity";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "occupancy", label: "Bin occupancy" },
  { key: "tasks", label: "Tasks" },
  { key: "waves", label: "Pick waves" },
  { key: "packages", label: "Packages" },
  { key: "productivity", label: "Productivity" },
];

const TASK_TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> =
  {
    PENDING: "neutral",
    ASSIGNED: "info",
    IN_PROGRESS: "info",
    COMPLETED: "ok",
    SHORT: "warn",
    CANCELLED: "neutral",
  };

/** Fullness colour: an over-filled bin is a real problem, not a warning. */
function occupancyTone(percent: number | null) {
  if (percent === null) return "neutral" as const;
  if (percent > 100) return "danger" as const;
  if (percent >= 85) return "warn" as const;
  return "ok" as const;
}

function productLabel(p: any) {
  if (!p) return "—";
  return [p.genericName, p.strength].filter(Boolean).join(" ");
}

export default function WarehousePage() {
  const { toast, confirm } = useFeedback();
  const [tab, setTab] = useState<Tab>("occupancy");
  const [warehouseId, setWarehouseId] = useState("");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openOnly, setOpenOnly] = useState(true);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);

  const org = useApi<any>("/admin/organization");
  const warehouses = (org.data?.branches ?? []).flatMap((b: any) =>
    (b.warehouses ?? []).map((w: any) => ({ ...w, branchName: b.name })),
  );

  useEffect(() => {
    if (!warehouseId && warehouses.length) setWarehouseId(warehouses[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses.length]);

  const scope = warehouseId ? `warehouseId=${warehouseId}` : "";

  const occupancy = useApi<any>(
    warehouseId && tab === "occupancy" ? `/warehouse/occupancy?${scope}` : null,
    [warehouseId, version],
  );
  const exceptions = useApi<any>(
    warehouseId ? `/warehouse/tasks/exceptions?${scope}` : null,
    [warehouseId, version],
  );
  const tasks = useApi<any>(
    warehouseId && tab === "tasks"
      ? `/warehouse/tasks?${scope}&pageSize=200${openOnly ? "&open=true" : ""}`
      : null,
    [warehouseId, version, openOnly],
  );
  const waves = useApi<any[]>(
    warehouseId && tab === "waves" ? `/warehouse/waves?${scope}` : null,
    [warehouseId, version],
  );
  const waveDetail = useApi<any>(
    selectedWave ? `/warehouse/waves/${selectedWave}` : null,
    [selectedWave, version],
  );
  const packages = useApi<any[]>(
    warehouseId && tab === "packages" ? `/warehouse/packages?${scope}` : null,
    [warehouseId, version],
  );
  const productivity = useApi<any>(
    warehouseId && tab === "productivity"
      ? `/warehouse/tasks/productivity?${scope}&days=30`
      : null,
    [warehouseId, version],
  );
  const replenishment = useApi<any[]>(
    warehouseId ? `/warehouse/replenishment-needs?${scope}` : null,
    [warehouseId, version],
  );

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body });
      toast(done, "ok");
      setVersion((v) => v + 1);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function releaseWave(wave: any) {
    const { confirmed } = await confirm({
      title: `Release wave ${wave.waveNo}?`,
      body: "Releasing reserves the stock behind every task in the wave and hands the work to the floor. Cancelling afterwards releases those reservations again.",
      confirmLabel: "Release",
    });
    if (!confirmed) return;
    await act(
      `/warehouse/waves/${wave.id}/release`,
      undefined,
      `Wave ${wave.waveNo} released`,
    );
  }

  async function cancelWave(wave: any) {
    const { confirmed, reason } = await confirm({
      title: `Cancel wave ${wave.waveNo}?`,
      body: "Open tasks are cancelled and any reservation they held is released. Work already completed stays completed.",
      confirmLabel: "Cancel wave",
      tone: "danger",
      requireReason: "Why is this wave being cancelled?",
    });
    if (!confirmed) return;
    await act(
      `/warehouse/waves/${wave.id}/cancel`,
      { reason },
      `Wave ${wave.waveNo} cancelled`,
    );
  }

  async function cancelTask(task: any) {
    const { confirmed, reason } = await confirm({
      title: `Cancel task ${task.taskNo ?? ""}?`,
      body: "The task is closed without moving stock, and any reservation it held is released.",
      confirmLabel: "Cancel task",
      tone: "danger",
      requireReason: "Why is this task being cancelled?",
    });
    if (!confirmed) return;
    await act(
      `/warehouse/tasks/${task.id}/cancel`,
      { reason },
      "Task cancelled",
    );
  }

  const summary = occupancy.data?.summary;
  const ex = exceptions.data;

  return (
    <Shell>
      <PageHeader
        title="Warehouse operations"
        subtitle="Bins, put-away, picking and dispatch. Every figure is read from the stock ledger and the task table — nothing here is a projection."
        action={
          <div className="flex items-center gap-2">
            <select
              className="input w-64"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {warehouses.map((w: any) => (
                <option key={w.id} value={w.id}>
                  {w.branchName} — {w.name}
                </option>
              ))}
            </select>
            <button
              className="btn-ghost"
              onClick={() => setVersion((v) => v + 1)}
            >
              Refresh
            </button>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}
      {org.loading && <Loading label="Loading warehouses" />}
      {!org.loading && !warehouses.length && (
        <Empty>
          No warehouse is configured. Create one under Administration before
          using this screen.
        </Empty>
      )}

      {ex && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Stalled over 24h"
            value={ex.staleTasks.length}
            tone={ex.staleTasks.length ? "warn" : "neutral"}
            sub="Open tasks nobody has finished"
          />
          <Stat
            label="Short picks"
            value={ex.shortPicks.length}
            tone={ex.shortPicks.length ? "danger" : "neutral"}
            sub="Picked less than asked for"
          />
          <Stat
            label="Unassigned"
            value={ex.unassignedCount}
            tone={ex.unassignedCount ? "warn" : "neutral"}
          />
          <Stat
            label="Over capacity"
            value={ex.overCapacityLocations.length}
            tone={ex.overCapacityLocations.length ? "danger" : "neutral"}
            sub="Bins holding more than they declare"
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "btn-primary" : "btn-ghost"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "occupancy" && (
        <div className="space-y-5">
          {occupancy.error && <ErrorBox message={occupancy.error} />}
          {occupancy.loading && <Loading label="Measuring bins" />}
          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Locations" value={summary.total} />
              <Stat
                label="Empty"
                value={summary.empty}
                sub="Available for put-away"
              />
              <Stat
                label="Average fullness"
                value={
                  summary.averageOccupancyPercent === null
                    ? "Not measured"
                    : `${summary.averageOccupancyPercent}%`
                }
                sub="Across bins with a declared capacity"
              />
              <Stat
                label="Unmetered"
                value={summary.unmetered}
                sub="No declared capacity, so fullness is unknown"
              />
            </div>
          )}
          {occupancy.data && (
            <Card title="Bins">
              <DataTable
                rows={occupancy.data.locations}
                getKey={(l: any) => l.id}
                exportName="bin-occupancy"
                searchPlaceholder="Search bins"
                pageSize={25}
                empty="This warehouse has no locations defined."
                columns={[
                  { key: "code", label: "Bin", value: (l: any) => l.code },
                  {
                    key: "name",
                    label: "Name",
                    value: (l: any) => l.name ?? "",
                  },
                  {
                    key: "locationType",
                    label: "Type",
                    value: (l: any) => l.locationType,
                  },
                  {
                    key: "storageCondition",
                    label: "Condition",
                    value: (l: any) => l.storageCondition ?? "",
                    render: (l: any) =>
                      l.storageCondition ? (
                        <Pill tone="info">{l.storageCondition}</Pill>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    key: "used",
                    label: "Units held",
                    numeric: true,
                    align: "right",
                    value: (l: any) => l.usedUnits,
                    render: (l: any) => qty(l.usedUnits),
                  },
                  {
                    key: "capacity",
                    label: "Capacity",
                    numeric: true,
                    align: "right",
                    value: (l: any) => l.capacityUnits ?? -1,
                    render: (l: any) =>
                      l.capacityUnits === null ? (
                        <span className="text-xs text-ink-subtle">
                          Not declared
                        </span>
                      ) : (
                        qty(l.capacityUnits)
                      ),
                  },
                  {
                    key: "occupancy",
                    label: "Fullness",
                    numeric: true,
                    align: "right",
                    value: (l: any) => l.occupancyPercent ?? -1,
                    render: (l: any) =>
                      l.occupancyPercent === null ? (
                        <span className="text-xs text-ink-subtle">Unknown</span>
                      ) : (
                        <Pill tone={occupancyTone(l.occupancyPercent)}>
                          {l.occupancyPercent}%
                        </Pill>
                      ),
                  },
                  {
                    key: "products",
                    label: "SKUs",
                    numeric: true,
                    align: "right",
                    value: (l: any) => l.distinctProducts,
                  },
                  {
                    key: "pickFace",
                    label: "Pick face",
                    optional: true,
                    value: (l: any) => (l.isPickFace ? "Yes" : "No"),
                  },
                  {
                    key: "barcode",
                    label: "Barcode",
                    optional: true,
                    value: (l: any) => l.barcode ?? "",
                  },
                ]}
              />
            </Card>
          )}

          {replenishment.data && (
            <Card title="Pick faces needing a top-up">
              {replenishment.data.length ? (
                <DataTable
                  rows={replenishment.data}
                  getKey={(r: any) => `${r.pickFaceId}-${r.productId}`}
                  pageSize={10}
                  exportName="pick-face-replenishment"
                  columns={[
                    {
                      key: "location",
                      label: "Pick face",
                      value: (r: any) => r.pickFaceCode,
                    },
                    {
                      key: "product",
                      label: "Product",
                      value: (r: any) => productLabel(r.product),
                    },
                    {
                      key: "onHand",
                      label: "At the face",
                      numeric: true,
                      align: "right",
                      value: (r: any) => r.onHand,
                      render: (r: any) => qty(r.onHand),
                    },
                    {
                      key: "capacity",
                      label: "Face capacity",
                      numeric: true,
                      align: "right",
                      value: (r: any) => r.capacity,
                      render: (r: any) => qty(r.capacity),
                    },
                    {
                      key: "suggested",
                      label: "Move",
                      numeric: true,
                      align: "right",
                      value: (r: any) => r.suggestedQuantity,
                      render: (r: any) => qty(r.suggestedQuantity),
                    },
                    {
                      key: "sources",
                      label: "From",
                      value: (r: any) =>
                        r.sources.map((s: any) => s.code).join(", "),
                      render: (r: any) => (
                        <span className="text-xs text-ink-muted">
                          {r.sources
                            .map((s: any) => `${s.code} (${qty(s.onHand)})`)
                            .join(", ")}
                        </span>
                      ),
                    },
                    {
                      key: "reason",
                      label: "Why",
                      optional: true,
                      value: (r: any) => r.reason,
                    },
                  ]}
                />
              ) : (
                <Empty>
                  Every pick face is stocked above its trigger level, or no bulk
                  stock is free to move.
                </Empty>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "tasks" && (
        <Card
          title="Warehouse tasks"
          action={
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
              />
              Open work only
            </label>
          }
        >
          {tasks.error && <ErrorBox message={tasks.error} />}
          {tasks.loading && <Loading />}
          {tasks.data && (
            <DataTable
              rows={tasks.data.data}
              getKey={(t: any) => t.id}
              exportName="warehouse-tasks"
              searchPlaceholder="Search tasks"
              empty={
                openOnly
                  ? "No open tasks. The floor is clear."
                  : "No tasks recorded."
              }
              columns={[
                {
                  key: "taskNo",
                  label: "Task",
                  value: (t: any) => t.taskNo ?? t.id.slice(0, 8),
                },
                {
                  key: "taskType",
                  label: "Type",
                  value: (t: any) => t.taskType,
                },
                {
                  key: "status",
                  label: "Status",
                  value: (t: any) => t.status,
                  render: (t: any) => (
                    <Pill tone={TASK_TONE[t.status] ?? "neutral"}>
                      {t.status}
                    </Pill>
                  ),
                },
                {
                  key: "product",
                  label: "Product",
                  value: (t: any) => productLabel(t.product),
                },
                {
                  key: "quantity",
                  label: "Qty",
                  numeric: true,
                  align: "right",
                  value: (t: any) => Number(t.quantity ?? 0),
                  render: (t: any) => (
                    <span>
                      {qty(t.quantityDone ?? 0)} / {qty(t.quantity ?? 0)}
                    </span>
                  ),
                },
                {
                  key: "from",
                  label: "From",
                  value: (t: any) => t.fromLocation?.code ?? "",
                },
                {
                  key: "to",
                  label: "To",
                  value: (t: any) => t.toLocation?.code ?? "",
                },
                {
                  key: "priority",
                  label: "Priority",
                  numeric: true,
                  align: "right",
                  optional: true,
                  value: (t: any) => t.priority ?? 0,
                },
                {
                  key: "created",
                  label: "Raised",
                  optional: true,
                  value: (t: any) => t.createdAt,
                  render: (t: any) => shortDate(t.createdAt),
                },
                {
                  key: "cancel",
                  label: "",
                  render: (t: any) =>
                    ["PENDING", "ASSIGNED", "IN_PROGRESS"].includes(
                      t.status,
                    ) ? (
                      <button
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => void cancelTask(t)}
                      >
                        Cancel
                      </button>
                    ) : null,
                },
              ]}
            />
          )}
        </Card>
      )}

      {tab === "waves" && (
        <div className="space-y-5">
          <Card title="Pick waves">
            {waves.error && <ErrorBox message={waves.error} />}
            {waves.loading && <Loading />}
            {waves.data && (
              <DataTable
                rows={waves.data}
                getKey={(w: any) => w.id}
                exportName="pick-waves"
                selectedKey={selectedWave}
                onRowClick={(w: any) =>
                  setSelectedWave((s) => (s === w.id ? null : w.id))
                }
                empty="No wave has been created for this warehouse."
                columns={[
                  { key: "waveNo", label: "Wave", value: (w: any) => w.waveNo },
                  {
                    key: "status",
                    label: "Status",
                    value: (w: any) => w.status,
                    render: (w: any) => (
                      <Pill
                        tone={
                          w.status === "RELEASED"
                            ? "info"
                            : w.status === "COMPLETED"
                              ? "ok"
                              : w.status === "CANCELLED"
                                ? "neutral"
                                : "warn"
                        }
                      >
                        {w.status}
                      </Pill>
                    ),
                  },
                  {
                    key: "tasks",
                    label: "Tasks",
                    numeric: true,
                    align: "right",
                    value: (w: any) => w._count?.tasks ?? 0,
                  },
                  {
                    key: "packages",
                    label: "Packages",
                    numeric: true,
                    align: "right",
                    value: (w: any) => w._count?.packages ?? 0,
                  },
                  {
                    key: "created",
                    label: "Created",
                    value: (w: any) => w.createdAt,
                    render: (w: any) => shortDate(w.createdAt),
                  },
                  {
                    key: "actions",
                    label: "",
                    render: (w: any) => (
                      <div className="flex gap-2">
                        {w.status === "PLANNED" && (
                          <button
                            className="btn-ghost"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void releaseWave(w);
                            }}
                          >
                            Release
                          </button>
                        )}
                        {["PLANNED", "RELEASED"].includes(w.status) && (
                          <button
                            className="btn-ghost"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void cancelWave(w);
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </Card>

          {selectedWave && waveDetail.data && (
            <Card
              title={`Wave ${waveDetail.data.waveNo} — tasks in pick order`}
              action={
                <button
                  className="btn-ghost"
                  onClick={() => setSelectedWave(null)}
                >
                  Close
                </button>
              }
            >
              <DataTable
                rows={waveDetail.data.tasks}
                getKey={(t: any) => t.id}
                pageSize={20}
                exportName={`wave-${waveDetail.data.waveNo}`}
                empty="This wave has no tasks."
                columns={[
                  {
                    key: "seq",
                    label: "Walk order",
                    numeric: true,
                    align: "right",
                    value: (t: any) => t.fromLocation?.pickSequence ?? 0,
                  },
                  {
                    key: "from",
                    label: "From bin",
                    value: (t: any) => t.fromLocation?.code ?? "",
                  },
                  {
                    key: "product",
                    label: "Product",
                    value: (t: any) => productLabel(t.product),
                  },
                  {
                    key: "quantity",
                    label: "Qty",
                    numeric: true,
                    align: "right",
                    value: (t: any) => Number(t.quantity ?? 0),
                    render: (t: any) => qty(t.quantity),
                  },
                  {
                    key: "status",
                    label: "Status",
                    value: (t: any) => t.status,
                    render: (t: any) => (
                      <Pill tone={TASK_TONE[t.status] ?? "neutral"}>
                        {t.status}
                      </Pill>
                    ),
                  },
                ]}
              />
            </Card>
          )}
        </div>
      )}

      {tab === "packages" && (
        <Card title="Packages">
          {packages.error && <ErrorBox message={packages.error} />}
          {packages.loading && <Loading />}
          {packages.data && (
            <DataTable
              rows={packages.data}
              getKey={(p: any) => p.id}
              exportName="packages"
              empty="Nothing has been packed yet."
              columns={[
                {
                  key: "packageNo",
                  label: "Package",
                  value: (p: any) => p.packageNo,
                },
                {
                  key: "wave",
                  label: "Wave",
                  value: (p: any) => p.wave?.waveNo ?? "—",
                },
                {
                  key: "status",
                  label: "Status",
                  value: (p: any) => p.status,
                  render: (p: any) => (
                    <Pill
                      tone={
                        p.status === "DISPATCHED"
                          ? "ok"
                          : p.status === "CANCELLED"
                            ? "neutral"
                            : "info"
                      }
                    >
                      {p.status}
                    </Pill>
                  ),
                },
                {
                  key: "lines",
                  label: "Lines",
                  numeric: true,
                  align: "right",
                  value: (p: any) => p.lines?.length ?? 0,
                },
                {
                  key: "weight",
                  label: "Weight (kg)",
                  numeric: true,
                  align: "right",
                  optional: true,
                  value: (p: any) => Number(p.weightKg ?? 0),
                },
                {
                  key: "created",
                  label: "Packed",
                  value: (p: any) => p.createdAt,
                  render: (p: any) => shortDate(p.createdAt),
                },
              ]}
            />
          )}
        </Card>
      )}

      {tab === "productivity" && (
        <div className="space-y-5">
          {productivity.error && <ErrorBox message={productivity.error} />}
          {productivity.loading && <Loading />}
          {productivity.data && (
            <>
              <Card
                title={`People — last ${productivity.data.windowDays} days`}
              >
                {productivity.data.byUser.length ? (
                  <DataTable
                    rows={productivity.data.byUser}
                    getKey={(r: any) => r.userId}
                    pageSize={15}
                    exportName="warehouse-productivity"
                    columns={[
                      {
                        key: "userName",
                        label: "Person",
                        value: (r: any) => r.userName,
                      },
                      {
                        key: "tasksCompleted",
                        label: "Tasks",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.tasksCompleted,
                      },
                      {
                        key: "unitsHandled",
                        label: "Units",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.unitsHandled,
                      },
                      {
                        key: "averageMinutes",
                        label: "Avg minutes",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.averageMinutes,
                      },
                      {
                        key: "compliance",
                        label: "Took the suggested bin",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.directedCompliancePercent ?? -1,
                        render: (r: any) =>
                          r.directedCompliancePercent === null ? (
                            <span className="text-xs text-ink-subtle">
                              No directed work
                            </span>
                          ) : (
                            `${r.directedCompliancePercent}%`
                          ),
                      },
                    ]}
                  />
                ) : (
                  <Empty>No task has been completed in this window.</Empty>
                )}
                <p className="mt-3 text-xs text-ink-subtle">
                  A low &ldquo;took the suggested bin&rdquo; figure means the
                  put-away recommendations are wrong for this warehouse, not
                  that the storekeeper is.
                </p>
              </Card>

              {productivity.data.byType.length > 0 && (
                <Card title="Average minutes by task type">
                  <BarChart
                    data={productivity.data.byType}
                    labelKey="taskType"
                    valueKey="averageMinutes"
                    format={(v) => `${v} min`}
                  />
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
