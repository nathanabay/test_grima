"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, can, qty, shortDate, tokenStore } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";
import {
  Card as Panel,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Stat,
} from "@/components/primitives";
import { DataTable } from "@/components/DataTable";
import { SeverityBadge, StatusBadge } from "@/components/status";

export default function ColdChainPage() {
  const [equipmentVersion, setEquipmentVersion] = useState(0);
  const live = useApi<any[]>("/cold-chain/live", [equipmentVersion]);
  const excursions = useApi<any>("/cold-chain/excursions?pageSize=25");

  return (
    <Shell>
      <PageHeader
        title="Cold Chain"
        subtitle="A breach that outlasts the sensor tolerance quarantines the affected stock automatically and waits for a QA decision."
      />

      <div className="space-y-4">
        <Card title="Live sensor readings">
          {live.loading && <Loading />}
          {live.error && <ErrorBox message={live.error} />}
          {live.data?.length ? (
            <Table
              head={[
                "Sensor",
                "Warehouse",
                "Required range",
                "Current",
                "Last reading",
                "Status",
              ]}
            >
              {live.data.map((s) => (
                <tr key={s.sensorId}>
                  <td className="td font-medium">
                    {s.name}
                    <div className="text-xs text-ink-subtle">{s.code}</div>
                  </td>
                  <td className="td text-ink-muted">{s.warehouseName}</td>
                  <td className="td text-ink-muted">{s.requiredRange}</td>
                  <td className="td num font-medium">
                    {s.currentTemperature !== null
                      ? `${Number(s.currentTemperature).toFixed(1)}C`
                      : "-"}
                    {s.currentHumidity !== null && (
                      <div className="text-xs text-ink-subtle">
                        {Number(s.currentHumidity).toFixed(0)}% RH
                      </div>
                    )}
                  </td>
                  <td className="td text-xs text-ink-muted">
                    {s.lastReadingAt
                      ? new Date(s.lastReadingAt).toLocaleString()
                      : "never"}
                  </td>
                  <td className="td">
                    <Pill
                      tone={
                        s.status === "OK"
                          ? "ok"
                          : s.status === "EXCURSION"
                            ? "danger"
                            : "warn"
                      }
                    >
                      {s.status}
                    </Pill>
                    {s.calibrationStatus !== "VALID" && (
                      <div className="mt-1 text-xs text-danger">
                        {s.calibrationStatus === "OVERDUE"
                          ? "Calibration lapsed"
                          : "Never calibrated"}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !live.loading && (
              <Empty>No temperature sensors are configured.</Empty>
            )
          )}
        </Card>

        <Card title="Temperature excursions">
          {excursions.loading && <Loading />}
          {excursions.data?.data?.length ? (
            <Table
              head={[
                "Excursion",
                "Sensor",
                "Started",
                "Duration",
                "Range reached",
                "Affected",
                "Disposition",
              ]}
            >
              {excursions.data.data.map((e: any) => (
                <tr key={e.id}>
                  <td className="td font-medium">{e.excursionNo}</td>
                  <td className="td text-ink-muted">{e.sensor.name}</td>
                  <td className="td text-ink-muted">
                    {shortDate(e.startedAt)}
                  </td>
                  <td className="td num">{e.durationMinutes} min</td>
                  <td className="td num">
                    {Number(e.minTempC).toFixed(1)}C –{" "}
                    {Number(e.maxTempC).toFixed(1)}C
                  </td>
                  <td className="td num">
                    {e.affectedBatchIds.length} batches
                    <div className="text-xs text-ink-subtle">
                      {qty(e.affectedQuantity)} units
                    </div>
                  </td>
                  <td className="td">
                    <Pill
                      tone={
                        e.disposition === "PENDING"
                          ? "warn"
                          : e.disposition === "RELEASED"
                            ? "ok"
                            : "danger"
                      }
                    >
                      {e.disposition}
                    </Pill>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !excursions.loading && (
              <Empty>No temperature excursions recorded.</Empty>
            )
          )}
        </Card>
        <Equipment onChanged={() => setEquipmentVersion((v) => v + 1)} />
      </div>
    </Shell>
  );
}

/**
 * Calibration and maintenance (§27: features 897-899).
 *
 * A reading is only evidence if the instrument that took it was calibrated. A
 * sensor past its certificate is still read — blinding the cold room would be
 * worse — but it is labelled everywhere it appears, because a QA release
 * resting on an uncertified sensor is a release resting on nothing.
 */
function Equipment({ onChanged }: { onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const [openSensor, setOpenSensor] = useState<any>(null);
  const due = useApi<any>("/cold-chain/equipment/due?withinDays=30", [version]);

  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canRecord = can(user, "quality.cold_chain.EDIT");

  const rows: any[] = due.data?.rows ?? [];

  return (
    <>
      <Panel
        title="Equipment calibration and service"
        description="Instruments whose certificate has lapsed, or whose next service falls due within 30 days. A sensor with no certificate at all is listed first — it is not 'due soon', it has never been calibrated."
        padded={false}
      >
        <div className="p-4">
          {due.error && (
            <ErrorState message={due.error} onRetry={due.refresh} />
          )}
          {due.loading && !due.data && <Loading />}

          {due.data && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  label="Active sensors"
                  value={due.data.activeSensors}
                  sub="Reporting equipment"
                />
                <Stat
                  label="Needing attention"
                  value={rows.length}
                  tone={rows.length ? "warn" : "ok"}
                  sub="Calibration or service"
                />
                <Stat
                  label="No valid certificate"
                  value={
                    rows.filter(
                      (r) => r.neverCalibrated || r.calibrationOverdue,
                    ).length
                  }
                  tone={
                    rows.some((r) => r.neverCalibrated || r.calibrationOverdue)
                      ? "danger"
                      : "ok"
                  }
                  sub="Readings cannot be relied on"
                />
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  title="Every sensor is in date"
                  body="Calibration certificates and service records are current across the estate."
                />
              ) : (
                <DataTable
                  rows={rows}
                  getKey={(r: any) => r.sensorId}
                  pageSize={15}
                  exportName="cold-chain-equipment-due"
                  searchPlaceholder="Search sensor or warehouse"
                  onRowClick={(r: any) => setOpenSensor(r)}
                  rowTone={(r: any) =>
                    r.severity === "CRITICAL"
                      ? "danger"
                      : r.severity === "HIGH"
                        ? "warn"
                        : null
                  }
                  columns={[
                    {
                      key: "severity",
                      label: "Severity",
                      width: "7rem",
                      value: (r: any) => r.severity,
                      render: (r: any) => <SeverityBadge level={r.severity} />,
                    },
                    { key: "code", label: "Sensor", value: (r: any) => r.code },
                    { key: "name", label: "Name", value: (r: any) => r.name },
                    {
                      key: "warehouse",
                      label: "Warehouse",
                      value: (r: any) => r.warehouse,
                    },
                    {
                      key: "calibrationDueAt",
                      label: "Calibration due",
                      value: (r: any) => r.calibrationDueAt ?? "",
                      render: (r: any) =>
                        r.neverCalibrated ? (
                          <span className="text-danger">never calibrated</span>
                        ) : (
                          shortDate(r.calibrationDueAt)
                        ),
                    },
                    {
                      key: "nextMaintenanceAt",
                      label: "Service due",
                      optional: true,
                      value: (r: any) => r.nextMaintenanceAt ?? "",
                      render: (r: any) =>
                        r.nextMaintenanceAt
                          ? shortDate(r.nextMaintenanceAt)
                          : "not scheduled",
                    },
                  ]}
                />
              )}
            </>
          )}
        </div>
      </Panel>

      <EquipmentDrawer
        sensor={openSensor}
        canRecord={canRecord}
        onClose={() => setOpenSensor(null)}
        onChanged={() => {
          setVersion((v) => v + 1);
          onChanged();
        }}
      />
    </>
  );
}

function EquipmentDrawer({
  sensor,
  canRecord,
  onClose,
  onChanged,
}: {
  sensor: any | null;
  canRecord: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<"calibration" | "maintenance">(
    "calibration",
  );
  const [result, setResult] = useState("PASS");
  const [certificateNo, setCertificateNo] = useState("");
  const [performedBy, setPerformedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [workType, setWorkType] = useState("PREVENTIVE");
  const [description, setDescription] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = useApi<any>(
    sensor ? `/cold-chain/equipment/${sensor.sensorId}` : null,
    [sensor?.sensorId, version],
  );

  async function submit() {
    if (!sensor) return;
    setBusy(true);
    setError(null);
    try {
      if (form === "calibration") {
        await api(`/cold-chain/equipment/${sensor.sensorId}/calibrations`, {
          method: "POST",
          body: {
            result,
            certificateNo: certificateNo || undefined,
            performedBy: performedBy || undefined,
            notes: notes || undefined,
          },
        });
      } else {
        await api(`/cold-chain/equipment/${sensor.sensorId}/maintenance`, {
          method: "POST",
          body: {
            workType,
            description,
            performedBy: performedBy || undefined,
            nextDueAt: nextDueAt
              ? new Date(nextDueAt).toISOString()
              : undefined,
          },
        });
      }
      setCertificateNo("");
      setNotes("");
      setDescription("");
      setVersion((v) => v + 1);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const data = detail.data;

  return (
    <Drawer
      open={!!sensor}
      onClose={onClose}
      width="lg"
      title={sensor ? `${sensor.name} (${sensor.code})` : "Sensor"}
      description={
        data
          ? `Calibration ${data.calibrationStatus.replace(/_/g, " ").toLowerCase()}`
          : undefined
      }
    >
      {detail.loading && !data && <Loading />}
      {detail.error && <ErrorState message={detail.error} />}
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={
                data.calibrationStatus === "VALID" ? "APPROVED" : "BLOCKED"
              }
            />
            <span className="text-small text-ink-muted">
              {data.lastCalibratedAt
                ? `Last calibrated ${shortDate(data.lastCalibratedAt)}`
                : "No certificate on file"}
              {data.calibrationDueAt
                ? ` · due ${shortDate(data.calibrationDueAt)}`
                : ""}
            </span>
          </div>

          {canRecord && (
            <Panel title="Record">
              <div className="mb-3 flex gap-1">
                {(["calibration", "maintenance"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setForm(f)}
                    className={`rounded px-2 py-1 text-small ${form === f ? "bg-brand/10 font-medium text-brand-dark" : "text-ink-muted hover:bg-surface-sunken"}`}
                  >
                    {f === "calibration" ? "Calibration" : "Service"}
                  </button>
                ))}
              </div>

              {form === "calibration" ? (
                <div className="space-y-3">
                  <Field
                    label="Result"
                    hint="A FAIL is recorded and does not extend the due date — the instrument is not calibrated."
                  >
                    <select
                      className="input"
                      value={result}
                      onChange={(e) => setResult(e.target.value)}
                    >
                      {["PASS", "ADJUSTED", "FAIL"].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Certificate number">
                    <input
                      className="input"
                      value={certificateNo}
                      onChange={(e) => setCertificateNo(e.target.value)}
                    />
                  </Field>
                  <Field label="Performed by">
                    <input
                      className="input"
                      value={performedBy}
                      onChange={(e) => setPerformedBy(e.target.value)}
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea
                      className="input min-h-[5rem]"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Work type">
                    <select
                      className="input"
                      value={workType}
                      onChange={(e) => setWorkType(e.target.value)}
                    >
                      {[
                        "PREVENTIVE",
                        "CORRECTIVE",
                        "BATTERY",
                        "REPLACEMENT",
                        "INSPECTION",
                      ].map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="What was done"
                    required
                    hint="A record with no description proves nothing."
                  >
                    <textarea
                      className="input min-h-[5rem]"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                  <Field label="Performed by">
                    <input
                      className="input"
                      value={performedBy}
                      onChange={(e) => setPerformedBy(e.target.value)}
                    />
                  </Field>
                  <Field label="Next service due">
                    <input
                      className="input"
                      type="date"
                      value={nextDueAt}
                      onChange={(e) => setNextDueAt(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              <button
                className="btn-primary btn-sm mt-3"
                disabled={
                  busy || (form === "maintenance" && !description.trim())
                }
                onClick={submit}
              >
                {busy ? "Recording..." : "Record"}
              </button>
            </Panel>
          )}

          <Panel
            title={`Calibration history (${data.calibrations.length})`}
            padded={false}
          >
            {data.calibrations.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No certificates on file"
                  body="Readings from this sensor cannot be relied on until it is calibrated."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.calibrations.map((c: any) => (
                  <li key={c.id} className="px-4 py-2.5 text-small">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          c.result === "FAIL"
                            ? "font-medium text-danger"
                            : "text-ink"
                        }
                      >
                        {c.result}
                      </span>
                      <span className="text-caption text-ink-subtle">
                        {shortDate(c.calibratedAt)}
                      </span>
                    </div>
                    <div className="text-caption text-ink-muted">
                      Valid until {shortDate(c.validUntil)}
                      {c.certificateNo
                        ? ` · certificate ${c.certificateNo}`
                        : ""}
                      {c.performedBy ? ` · ${c.performedBy}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={`Service history (${data.maintenance.length})`}
            padded={false}
          >
            {data.maintenance.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No service recorded"
                  body="Preventive service, repairs and battery changes appear here."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.maintenance.map((m: any) => (
                  <li key={m.id} className="px-4 py-2.5 text-small">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink">{m.workType}</span>
                      <span className="text-caption text-ink-subtle">
                        {shortDate(m.performedAt)}
                      </span>
                    </div>
                    <div className="text-caption text-ink-muted">
                      {m.description}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </Drawer>
  );
}
