"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { useDeepLink, syncDeepLink } from "@/lib/deepLink";
import { usePaged } from "@/lib/paged";
import { api, shortDate } from "@/lib/api";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pager,
  Pill,
  Table,
} from "@/components/ui";

const STAGES = [
  "REPORTED",
  "INVESTIGATING",
  "ROOT_CAUSE_IDENTIFIED",
  "CORRECTIVE_ACTION",
  "PREVENTIVE_ACTION",
  "VERIFICATION",
  "CLOSED",
];

const TYPES = [
  "DAMAGED_PRODUCT",
  "TEMPERATURE_EXCURSION",
  "SUSPECTED_COUNTERFEIT",
  "SUPPLIER_QUALITY_ISSUE",
  "INCORRECT_SHIPMENT",
  "PACKAGING_DEFECT",
  "RECALL",
  "STORAGE_VIOLATION",
];

/** Which field the next stage demands, mirroring the server's rule. */
const EVIDENCE_FIELD: Record<string, string | null> = {
  ROOT_CAUSE_IDENTIFIED: "rootCause",
  CORRECTIVE_ACTION: "correctiveAction",
  PREVENTIVE_ACTION: "preventiveAction",
  VERIFICATION: "verification",
};

export default function QualityPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A notification names a record; opening it should open that record, not a
  // list the reader then searches by hand.
  const link = useDeepLink("id");
  useEffect(() => {
    if (link.id) setSelectedId(link.id);
  }, [link.id]);
  useEffect(() => {
    syncDeepLink({ id: selectedId });
  }, [selectedId]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = usePaged<any>("/quality-incidents", {
    filters: message ? `v=${encodeURIComponent(message)}` : "",
    pageSize: 25,
  });
  const summary = useApi<any>("/quality-incidents/summary", [message]);
  const detail = useApi<any>(
    selectedId ? `/quality-incidents/${selectedId}` : null,
    [selectedId, message],
  );

  async function advance(status: string) {
    const field = EVIDENCE_FIELD[status];
    const body: any = { status };

    if (field) {
      const prompts: Record<string, string> = {
        rootCause: "Root cause — what actually caused this?",
        correctiveAction:
          "Corrective action — what has been done about this occurrence?",
        preventiveAction: "Preventive action — what stops it happening again?",
        verification: "Verification — what evidence shows the actions worked?",
      };
      const value = window.prompt(prompts[field]);
      if (!value) return;
      body[field] = value;
    }
    if (status === "CLOSED" && detail.data?.status === "REPORTED") {
      const note = window.prompt(
        "Closing without investigating requires a justification:",
      );
      if (!note) return;
      body.closureNote = note;
    }

    setBusy(true);
    setError(null);
    try {
      await api(`/quality-incidents/${selectedId}/advance`, {
        method: "POST",
        body,
      });
      setMessage(`Advanced to ${status.replace(/_/g, " ").toLowerCase()}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Quality Incidents & CAPA"
        subtitle="Each stage must record the evidence it exists to produce. An incident cannot be closed with an empty investigation."
        action={
          <button
            className="btn-primary"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Cancel" : "Report incident"}
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
            <div className="text-xs text-ink-muted">Open incidents</div>
            <div className="text-lg font-semibold num">{summary.data.open}</div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-ink-muted">Total raised</div>
            <div className="text-lg font-semibold num">
              {summary.data.total}
            </div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-ink-muted">Avg days to close</div>
            <div className="text-lg font-semibold num">
              {summary.data.averageDaysToClose ?? "-"}
            </div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-ink-muted">Overdue (30d+)</div>
            <div
              className={`text-lg font-semibold num ${summary.data.overdue.length ? "text-danger" : ""}`}
            >
              {summary.data.overdue.length}
            </div>
          </div>
        </div>
      )}

      {creating && (
        <Card className="mb-4" title="Report a quality incident">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError(null);
              try {
                const created = await api("/quality-incidents", {
                  method: "POST",
                  body: {
                    type: String(f.get("type")),
                    description: String(f.get("description")),
                    batchId: String(f.get("batchId") || "") || undefined,
                    quarantineBatch: f.get("quarantine") === "on",
                  },
                });
                setCreating(false);
                setSelectedId(created.id);
                setMessage(`Incident ${created.incidentNo} raised.`);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <label className="label">Type</label>
              <select aria-label="Type" name="type" className="input">
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Batch id (optional)</label>
              <input
                aria-label="Batch id (optional)"
                name="batchId"
                className="input"
                placeholder="Paste a batch id to link and quarantine it"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">What was observed</label>
              <textarea
                aria-label="What was observed"
                name="description"
                className="input"
                rows={3}
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="quarantine" defaultChecked />
              Quarantine the linked batch immediately
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary" disabled={busy}>
                Report incident
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          title={`${list.total.toLocaleString()} ${list.total === 1 ? "incident" : "incidents"}`}
        >
          {list.loading && <Loading />}
          {list.rows.length ? (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.rows.map((i: any) => (
                <button
                  key={i.id}
                  onClick={() => setSelectedId(i.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === i.id ? "border-brand bg-brand-light" : "border-transparent hover:bg-surface-sunken"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{i.incidentNo}</span>
                    <Pill
                      tone={
                        i.status === "CLOSED"
                          ? "ok"
                          : i.status === "REPORTED"
                            ? "warn"
                            : "info"
                      }
                    >
                      {i.status.replace(/_/g, " ")}
                    </Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {i.type.replace(/_/g, " ")} · {shortDate(i.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No incidents recorded.</Empty>
          )}
          <Pager
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={list.setPage}
            loading={list.loading}
            noun="incident"
          />
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && (
            <Card>
              <Empty>Select an incident.</Empty>
            </Card>
          )}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card
              title={`${detail.data.incidentNo} — ${detail.data.type.replace(/_/g, " ")}`}
            >
              {/* Stage rail: where the CAPA has reached. */}
              <ol className="mb-4 flex flex-wrap gap-1 text-[11px]">
                {STAGES.map((s) => {
                  const idx = STAGES.indexOf(detail.data.status);
                  const here = STAGES.indexOf(s);
                  return (
                    <li
                      key={s}
                      className={`rounded px-1.5 py-0.5 ${here < idx ? "bg-ok-light text-ok" : here === idx ? "bg-brand text-brand-fg" : "bg-surface-sunken text-ink-subtle"}`}
                    >
                      {s.replace(/_/g, " ")}
                    </li>
                  );
                })}
              </ol>

              <p className="text-sm">{detail.data.description}</p>
              <dl className="mt-3 space-y-2 text-sm">
                {[
                  ["Root cause", detail.data.rootCause],
                  ["Corrective action", detail.data.correctiveAction],
                  ["Preventive action", detail.data.preventiveAction],
                  ["Verification", detail.data.verification],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <dt className="text-xs text-ink-muted">{k}</dt>
                    <dd className={v ? "" : "text-ink-subtle italic"}>
                      {v || "not yet recorded"}
                    </dd>
                  </div>
                ))}
              </dl>

              {detail.data.batch && (
                <div className="mt-3 rounded-md bg-surface-sunken p-2 text-xs">
                  Batch {detail.data.batch.batchNumber} ·{" "}
                  <Pill
                    tone={
                      ["AVAILABLE", "RELEASED"].includes(
                        detail.data.batch.status,
                      )
                        ? "ok"
                        : "warn"
                    }
                  >
                    {detail.data.batch.status}
                  </Pill>
                </div>
              )}

              {detail.data.nextStatuses?.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-border pt-3">
                  {detail.data.nextStatuses.map((s: string) => (
                    <button
                      key={s}
                      className={s === "CLOSED" ? "btn-ghost" : "btn-primary"}
                      disabled={busy}
                      onClick={() => advance(s)}
                    >
                      {s === "CLOSED"
                        ? "Close"
                        : `Advance to ${s.replace(/_/g, " ").toLowerCase()}`}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
