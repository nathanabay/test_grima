"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import {
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Stat,
  Field,
} from "@/components/primitives";
import { DataTable } from "@/components/DataTable";
import { StatusBadge, statusLabel } from "@/components/status";
import { useApi } from "@/lib/useApi";
import { api, can, shortDate, tokenStore } from "@/lib/api";

/**
 * Serial register (§3: features 141-150).
 *
 * A serialised pack is a physical object, so this screen answers two questions
 * and keeps them apart: where is it now (the status column), and how did it get
 * there (the history in the drawer). The actions offered on a pack come from
 * the server's own state machine rather than from a list hardcoded here, so the
 * UI can never offer a move the API will refuse.
 */

interface SerialRow {
  id: string;
  serial: string;
  status: string;
  warehouseId: string | null;
  lastReferenceType: string | null;
  lastMovedAt: string | null;
  allowedEvents: string[];
  batch: {
    id: string;
    batchNumber: string;
    expiryDate: string;
    status: string;
    product: {
      id: string;
      sku: string;
      genericName: string;
      brandName: string | null;
      strength: string;
    };
  };
}

interface SerialEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  referenceType: string | null;
  referenceNo: string | null;
  reason: string | null;
  occurredAt: string;
  performedByName: string | null;
}

/** Wording an operator recognises, rather than the machine event name. */
const EVENT_LABEL: Record<string, string> = {
  RECEIVED: "Receive into stock",
  DISPENSED: "Record as dispensed",
  SOLD: "Record as sold",
  TRANSFERRED: "Send on a transfer",
  RETURNED: "Record a return",
  RECALLED: "Mark recalled",
  RELEASED: "Release back to stock",
  DESTROYED: "Record destruction",
  CORRECTED: "Correct this record",
};

export default function SerialsPage() {
  return (
    <Shell>
      <SerialsBody />
    </Shell>
  );
}

function SerialsBody() {
  const [serial, setSerial] = useState("");
  const [status, setStatus] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canMove = can(user, "inventory.serial.EDIT");
  const canImport = can(user, "inventory.serial.IMPORT");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(serial.trim()), 250);
    return () => clearTimeout(t);
  }, [serial]);

  const query = new URLSearchParams({ pageSize: "100" });
  if (debounced) query.set("serial", debounced);
  if (status) query.set("status", status);

  const list = useApi<{ data: SerialRow[]; meta: { total: number } }>(
    `/serials?${query.toString()}`,
    [debounced, status, reload],
  );
  const summary = useApi<{
    total: number;
    byStatus: Array<{ status: string; count: number }>;
  }>("/serials/summary", [reload]);

  const rows = list.data?.data ?? [];
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of summary.data?.byStatus ?? []) map[s.status] = s.count;
    return map;
  }, [summary.data]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  return (
    <>
      <PageHeader
        title="Serial register"
        subtitle="Every serialised pack, where it is now and how it got there. Movements are appended, never edited — a mistake is corrected by recording the correction."
        action={
          <div className="flex gap-2">
            {canImport && <ImportButton onDone={refresh} />}
            <button className="btn-ghost btn-sm" onClick={refresh}>
              Refresh
            </button>
          </div>
        }
      />

      {list.error && <ErrorState message={list.error} onRetry={refresh} />}
      {list.loading && !list.data && <Loading label="Reading the register" />}

      {list.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="Registered packs"
              value={summary.data?.total ?? 0}
              sub="All batches"
            />
            <Stat
              label="In stock"
              value={counts.IN_STOCK ?? 0}
              tone="ok"
              sub="Available to move"
              onClick={() => setStatus("IN_STOCK")}
            />
            <Stat
              label="In transit"
              value={counts.TRANSFERRED ?? 0}
              sub="Dispatched, not yet received"
              onClick={() => setStatus("TRANSFERRED")}
            />
            <Stat
              label="Recalled"
              value={counts.RECALLED ?? 0}
              tone={counts.RECALLED ? "danger" : "neutral"}
              sub="Must not be supplied"
              onClick={() => setStatus("RECALLED")}
            />
            <Stat
              label="Destroyed"
              value={counts.DESTROYED ?? 0}
              sub="Terminal — no further movement"
              onClick={() => setStatus("DESTROYED")}
            />
          </div>

          <Card
            title="Packs"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input w-auto py-1 text-small"
                  placeholder="Serial printed on the pack"
                  aria-label="Serial number"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                />
                <select
                  className="input w-auto py-1 text-small"
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Every status</option>
                  {[
                    "IN_STOCK",
                    "TRANSFERRED",
                    "DISPENSED",
                    "SOLD",
                    "RETURNED",
                    "RECALLED",
                    "DESTROYED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            }
            padded={false}
          >
            <div className="p-4">
              {rows.length === 0 ? (
                <EmptyState
                  title="No serialised packs match"
                  body="Serials are registered when a delivery carrying them is received, or uploaded against a batch. Clear the filters to see everything."
                />
              ) : (
                <DataTable
                  rows={rows}
                  getKey={(r) => r.id}
                  pageSize={25}
                  exportName="serial-register"
                  searchPlaceholder="Search serial, batch or product"
                  viewKey="serials"
                  total={list.data.meta.total}
                  onRowClick={(r) => setOpenId(r.id)}
                  selectedKey={openId}
                  rowTone={(r) => (r.status === "RECALLED" ? "danger" : null)}
                  columns={[
                    {
                      key: "serial",
                      label: "Serial",
                      sticky: true,
                      value: (r) => r.serial,
                    },
                    {
                      key: "product",
                      label: "Product",
                      value: (r) =>
                        `${r.batch.product.genericName} ${r.batch.product.strength}`,
                      render: (r) => (
                        <div>
                          <div className="text-ink">
                            {r.batch.product.genericName}{" "}
                            {r.batch.product.strength}
                          </div>
                          <div className="text-caption text-ink-subtle">
                            {r.batch.product.sku}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "batch",
                      label: "Batch",
                      value: (r) => r.batch.batchNumber,
                    },
                    {
                      key: "expiry",
                      label: "Expiry",
                      value: (r) => r.batch.expiryDate,
                      render: (r) => shortDate(r.batch.expiryDate),
                    },
                    {
                      key: "status",
                      label: "Status",
                      width: "9rem",
                      value: (r) => r.status,
                      render: (r) => <StatusBadge status={r.status} />,
                    },
                    {
                      key: "lastMovedAt",
                      label: "Last moved",
                      optional: true,
                      value: (r) => r.lastMovedAt ?? "",
                      render: (r) =>
                        r.lastMovedAt ? shortDate(r.lastMovedAt) : "—",
                    },
                    {
                      key: "lastReferenceType",
                      label: "Last document",
                      optional: true,
                      value: (r) => r.lastReferenceType ?? "",
                      render: (r) => r.lastReferenceType ?? "—",
                    },
                  ]}
                />
              )}
            </div>
          </Card>
        </div>
      )}

      <SerialDrawer
        id={openId}
        canMove={canMove}
        onClose={() => setOpenId(null)}
        onChanged={refresh}
      />
    </>
  );
}

function SerialDrawer({
  id,
  canMove,
  onClose,
  onChanged,
}: {
  id: string | null;
  canMove: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [version, setVersion] = useState(0);
  const detail = useApi<SerialRow & { events: SerialEvent[] }>(
    id ? `/serials/${id}` : null,
    [id, version],
  );
  const [event, setEvent] = useState("");
  const [reason, setReason] = useState("");
  const [correctedTo, setCorrectedTo] = useState("IN_STOCK");
  const [referenceNo, setReferenceNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEvent("");
    setReason("");
    setReferenceNo("");
    setError(null);
  }, [id]);

  async function record() {
    if (!id || !event) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/serials/${id}/events`, {
        method: "POST",
        body: {
          eventType: event,
          reason: reason || undefined,
          referenceNo: referenceNo || undefined,
          correctedTo: event === "CORRECTED" ? correctedTo : undefined,
        },
      });
      setEvent("");
      setReason("");
      setReferenceNo("");
      setVersion((v) => v + 1);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const serial = detail.data;

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width="lg"
      title={serial ? `Serial ${serial.serial}` : "Serial"}
      description={
        serial
          ? `${serial.batch.product.genericName} ${serial.batch.product.strength} · batch ${serial.batch.batchNumber}`
          : undefined
      }
    >
      {detail.loading && !serial && (
        <Loading label="Reading the pack history" />
      )}
      {detail.error && <ErrorState message={detail.error} />}

      {serial && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={serial.status} />
            <span className="text-small text-ink-muted">
              Expires {shortDate(serial.batch.expiryDate)}
            </span>
          </div>

          {canMove && serial.allowedEvents.length > 0 && (
            <Card title="Record a movement">
              {error && (
                <div className="mb-3">
                  <ErrorState message={error} />
                </div>
              )}
              <div className="space-y-3">
                <Field label="What happened">
                  <select
                    className="input"
                    value={event}
                    onChange={(e) => setEvent(e.target.value)}
                  >
                    <option value="">Choose a movement…</option>
                    {serial.allowedEvents.map((e) => (
                      <option key={e} value={e}>
                        {EVENT_LABEL[e] ?? statusLabel(e)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-caption text-ink-subtle">
                    Only movements the lifecycle allows from{" "}
                    {statusLabel(serial.status)} are offered.
                  </p>
                </Field>

                {event === "CORRECTED" && (
                  <Field
                    label="Corrected status"
                    hint="The original entry stays visible; this records what it should have said."
                  >
                    <select
                      className="input"
                      value={correctedTo}
                      onChange={(e) => setCorrectedTo(e.target.value)}
                    >
                      {[
                        "IN_STOCK",
                        "TRANSFERRED",
                        "DISPENSED",
                        "SOLD",
                        "RETURNED",
                        "RECALLED",
                        "DESTROYED",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field
                  label="Document reference"
                  hint="The transfer, sale or disposal note this movement belongs to."
                >
                  <input
                    className="input"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                  />
                </Field>

                <Field
                  label="Reason"
                  required={event === "CORRECTED"}
                  hint={
                    event === "CORRECTED"
                      ? "A correction must say why the record was wrong."
                      : undefined
                  }
                >
                  <input
                    className="input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>

                <button
                  className="btn-primary btn-sm"
                  disabled={
                    busy || !event || (event === "CORRECTED" && !reason.trim())
                  }
                  onClick={record}
                >
                  {busy ? "Recording…" : "Record movement"}
                </button>
              </div>
            </Card>
          )}

          <Card title="History" padded={false}>
            <ol className="divide-y divide-border">
              {serial.events.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={e.toStatus} />
                      <span className="text-small text-ink">
                        {EVENT_LABEL[e.eventType] ?? statusLabel(e.eventType)}
                      </span>
                    </div>
                    <span className="text-caption text-ink-subtle">
                      {shortDate(e.occurredAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-caption text-ink-muted">
                    {e.fromStatus
                      ? `${statusLabel(e.fromStatus)} → ${statusLabel(e.toStatus)}`
                      : "First entry"}
                    {e.referenceNo ? ` · ${e.referenceNo}` : ""}
                    {e.performedByName ? ` · ${e.performedByName}` : ""}
                  </div>
                  {e.reason && (
                    <p className="mt-1 text-caption text-ink-muted">
                      {e.reason}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </Drawer>
  );
}

/** Bulk registration of the serials delivered with a batch. */
function ImportButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const batches = useApi<any>(open ? "/inventory/batches?pageSize=100" : null, [
    open,
  ]);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const serials = text
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api("/serials/import", {
        method: "POST",
        body: { batchId, serials },
      });
      setResult(res);
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-sm btn-primary" onClick={() => setOpen(true)}>
        Register serials
      </button>
      <Drawer
        open={open}
        onClose={() => {
          setOpen(false);
          setResult(null);
        }}
        title="Register serials against a batch"
        description="Serials already registered are reported rather than overwritten — the same serial arriving twice is a counterfeit signal, not a duplicate row to tidy away."
      >
        {error && (
          <div className="mb-3">
            <ErrorState message={error} />
          </div>
        )}
        <div className="space-y-3">
          <Field label="Batch" required>
            <select
              className="input"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              <option value="">Choose a batch…</option>
              {(batches.data?.data ?? []).map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.product?.genericName} {b.product?.strength} ·{" "}
                  {b.batchNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Serials"
            hint="One per line, or separated by commas or spaces."
          >
            <textarea
              className="input min-h-[10rem] font-mono text-small"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <button
            className="btn-primary btn-sm"
            disabled={busy || !batchId || !text.trim()}
            onClick={submit}
          >
            {busy ? "Registering…" : "Register"}
          </button>

          {result && (
            <div className="rounded-card border border-border p-3 text-small">
              <p className="text-ink">{result.created} serial(s) registered.</p>
              {result.duplicates.length > 0 && (
                <p className="mt-1 text-warn">
                  {result.duplicates.length} already registered:{" "}
                  {result.duplicates
                    .slice(0, 5)
                    .map((d: any) => d.serial)
                    .join(", ")}
                  {result.duplicates.length > 5 ? "…" : ""}
                </p>
              )}
              {result.invalid.length > 0 && (
                <p className="mt-1 text-danger">
                  {result.invalid.length} rejected:{" "}
                  {result.invalid
                    .slice(0, 5)
                    .map((d: any) => `${d.serial} (${d.reason})`)
                    .join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      </Drawer>
    </>
  );
}
