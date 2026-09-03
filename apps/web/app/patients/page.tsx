"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { useDeepLink, syncDeepLink } from "@/lib/deepLink";
import { usePaged } from "@/lib/paged";
import { api, can, qty, shortDate, tokenStore } from "@/lib/api";
import { useFeedback } from "@/components/Feedback";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pager,
  Pill,
  Table,
} from "@/components/ui";
import {
  Card as Panel,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Stat,
} from "@/components/primitives";

/**
 * Patients and customers (§25).
 *
 * Clinical fields and dispensing history are withheld from roles without a
 * clinical reason to see them — the server enforces that, and this screen
 * simply does not render what it is not sent. Every record opened is audited.
 */
export default function PatientsPage() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
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

  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canEdit = can(user, "sales.patient.CREATE");
  const canSeeHistory = can(user, "dispensing.dispensing.READ");
  const canMerge = can(user, "sales.patient.DELETE");
  const [governance, setGovernance] = useState(false);

  const list = usePaged<any>("/patients", {
    filters: [
      query ? `q=${encodeURIComponent(query)}` : "",
      message ? `v=${encodeURIComponent(message)}` : "",
    ]
      .filter(Boolean)
      .join("&"),
    pageSize: 50,
  });
  const detail = useApi<any>(selectedId ? `/patients/${selectedId}` : null, [
    selectedId,
  ]);
  const history = useApi<any[]>(
    selectedId && canSeeHistory ? `/patients/${selectedId}/history` : null,
    [selectedId],
  );

  return (
    <Shell>
      <PageHeader
        title="Patients & Customers"
        subtitle="Only what the pharmacy needs to operate. Clinical notes are restricted by role, and opening a record is audited."
        action={
          <div className="flex gap-2">
            {canMerge && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => setGovernance(true)}
              >
                Duplicates &amp; retention
              </button>
            )}
            {canEdit && (
              <button
                className="btn-primary"
                onClick={() => setCreating((v) => !v)}
              >
                {creating ? "Cancel" : "Add patient"}
              </button>
            )}
          </div>
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
        <Card className="mb-4" title="New patient">
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const created = await api("/patients", {
                  method: "POST",
                  body: {
                    fullName: f.get("fullName"),
                    dateOfBirth: f.get("dateOfBirth") || undefined,
                    sex: f.get("sex") || undefined,
                    phone: f.get("phone") || undefined,
                    city: f.get("city") || undefined,
                    allergies: f.get("allergies") || undefined,
                    emergencyContactName: f.get("ecName") || undefined,
                    emergencyContactPhone: f.get("ecPhone") || undefined,
                  },
                });
                setCreating(false);
                setSelectedId(created.id);
                setMessage(`Patient ${created.patientCode} created.`);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <div className="sm:col-span-2">
              <label className="label">Full name</label>
              <input name="fullName" className="input" required />
            </div>
            <div>
              <label className="label">Date of birth</label>
              <input name="dateOfBirth" type="date" className="input" />
            </div>
            <div>
              <label className="label">Sex</label>
              <select name="sex" className="input">
                <option value="">—</option>
                <option>M</option>
                <option>F</option>
              </select>
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" className="input" />
            </div>
            <div>
              <label className="label">City</label>
              <input name="city" className="input" />
            </div>
            <div>
              <label className="label">Emergency contact</label>
              <input name="ecName" className="input" />
            </div>
            <div>
              <label className="label">Emergency phone</label>
              <input name="ecPhone" className="input" />
            </div>
            <div>
              <label className="label">Known allergies</label>
              <input
                name="allergies"
                className="input"
                placeholder="e.g. Penicillin"
              />
            </div>
            <div className="sm:col-span-3">
              <button className="btn-primary">Create patient</button>
            </div>
          </form>
        </Card>
      )}

      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(term);
          }}
        >
          <input
            className="input flex-1"
            placeholder="Search name, patient code or phone"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button className="btn-primary">Search</button>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          title={`${list.total.toLocaleString()} ${list.total === 1 ? "patient" : "patients"}`}
        >
          {list.loading && <Loading />}
          {list.rows.length ? (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.rows.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === p.id ? "border-brand bg-brand-light" : "border-transparent hover:bg-surface-sunken"}`}
                >
                  <div className="font-medium">{p.fullName}</div>
                  <div className="text-xs text-ink-subtle">
                    {p.patientCode}
                    {p.phone ? ` · ${p.phone}` : ""}
                    {p.city ? ` · ${p.city}` : ""}
                  </div>
                  {p.allergies && <Pill tone="danger">allergies</Pill>}
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No patients match.</Empty>
          )}
          <Pager
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={list.setPage}
            loading={list.loading}
            noun="patient"
          />
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && (
            <Card>
              <Empty>Select a patient.</Empty>
            </Card>
          )}
          {detail.loading && <Loading />}
          {detail.data && (
            <div className="space-y-4">
              <Card title={detail.data.fullName}>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ["Patient code", detail.data.patientCode],
                    ["Date of birth", shortDate(detail.data.dateOfBirth)],
                    ["Sex", detail.data.sex],
                    ["Phone", detail.data.phone],
                    ["City", detail.data.city],
                    ["Emergency contact", detail.data.emergencyContactName],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-xs text-ink-muted">{k}</dt>
                      <dd className="text-sm font-medium">{v || "-"}</dd>
                    </div>
                  ))}
                </dl>

                {detail.data.allergies !== undefined && (
                  <div
                    className={`mt-3 rounded-md px-3 py-2 text-sm ${detail.data.allergies ? "bg-danger-light text-danger" : "bg-surface-sunken text-ink-muted"}`}
                  >
                    <strong>Allergies:</strong>{" "}
                    {detail.data.allergies || "none recorded"}
                  </div>
                )}
                {detail.data.allergies === undefined && (
                  <p className="mt-3 text-xs text-ink-subtle">
                    Clinical information is not shown for your role.
                  </p>
                )}
              </Card>

              {detail.data.prescriptions && (
                <Card
                  title={`Prescriptions (${detail.data.prescriptions.length})`}
                >
                  <Table
                    head={["Number", "Date", "Prescriber", "Status", "Items"]}
                  >
                    {detail.data.prescriptions.map((p: any) => (
                      <tr key={p.id}>
                        <td className="td font-medium">{p.prescriptionNo}</td>
                        <td className="td text-ink-muted">
                          {shortDate(p.prescriptionDate)}
                        </td>
                        <td className="td text-xs">{p.prescriberName}</td>
                        <td className="td">
                          <Pill tone={p.status === "DISPENSED" ? "ok" : "info"}>
                            {p.status.replace(/_/g, " ")}
                          </Pill>
                        </td>
                        <td className="td num">{p.items.length}</td>
                      </tr>
                    ))}
                  </Table>
                </Card>
              )}

              {canSeeHistory && history.data && (
                <Card title={`Dispensing history (${history.data.length})`}>
                  {history.data.length ? (
                    <Table head={["Dispensing", "When", "Prescriber", "Items"]}>
                      {history.data.map((d) => (
                        <tr key={d.id}>
                          <td className="td font-medium">{d.dispensingNo}</td>
                          <td className="td text-ink-muted">
                            {shortDate(d.dispensedAt)}
                          </td>
                          <td className="td text-xs">
                            {d.prescription?.prescriberName ?? "-"}
                          </td>
                          <td className="td num">{d.items.length}</td>
                        </tr>
                      ))}
                    </Table>
                  ) : (
                    <Empty>Nothing dispensed to this patient yet.</Empty>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      <GovernanceDrawer
        open={governance}
        onClose={() => setGovernance(false)}
        onChanged={(m) => setMessage(m)}
        onOpenPatient={(id) => {
          setGovernance(false);
          setSelectedId(id);
        }}
      />
    </Shell>
  );
}

/**
 * Duplicate detection, merge and retention (§14: features 656-659).
 *
 * Nothing is merged automatically and nothing is erased automatically. Two
 * people really can share a name and a birthday, and merging the wrong pair
 * puts one patient's allergies on another patient's record; erasing on a timer
 * is how a record still needed for an open recall disappears.
 */
function GovernanceDrawer({
  open,
  onClose,
  onChanged,
  onOpenPatient,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
  onOpenPatient: (id: string) => void;
}) {
  const { prompt } = useFeedback();
  const [view, setView] = useState<"duplicates" | "retention">("duplicates");
  const [years, setYears] = useState(7);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicates = useApi<any>(
    open && view === "duplicates" ? "/patients/duplicates" : null,
    [open, version],
  );
  const retention = useApi<any>(
    open && view === "retention"
      ? `/patients/retention-candidates?years=${years}`
      : null,
    [open, years, version],
  );

  async function merge(sourceId: string, targetId: string, label: string) {
    const answer = await prompt({
      title: `Merge ${label}?`,
      body: "One patient record absorbs the other: prescriptions, dispensings and allergies are repointed, and the merge cannot be undone from here. Say why, because this goes into the audit trail.",
      confirmLabel: "Merge them",
      tone: "danger",
      fields: [
        {
          name: "reason",
          label: "Why these are the same person",
          type: "textarea",
          required: true,
          defaultValue: "Confirmed duplicate at the counter",
        },
      ],
    });
    if (!answer) return;
    const reason = answer.reason;
    setBusy(true);
    setError(null);
    try {
      await api(`/patients/${sourceId}/merge`, {
        method: "POST",
        body: { targetId, reason },
      });
      onChanged(
        `${label} merged. History was repointed and allergies were combined.`,
      );
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function anonymize(id: string, code: string) {
    const answer = await prompt({
      title: `Anonymise ${code}?`,
      body: "The identifying fields are cleared and cannot be recovered. The pharmacy record — what was dispensed, when — is kept, because it is a legal record that erasure does not reach.",
      confirmLabel: "Anonymise",
      tone: "danger",
      fields: [
        {
          name: "reason",
          label: "Why this patient is being anonymised",
          type: "textarea",
          required: true,
          defaultValue: "Erasure requested by the patient",
        },
      ],
    });
    if (!answer) return;
    const reason = answer.reason;
    setBusy(true);
    setError(null);
    try {
      await api(`/patients/${id}/anonymize`, {
        method: "POST",
        body: { reason },
      });
      onChanged(
        `${code} anonymised. Dispensing history is intact; the identity is gone.`,
      );
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Duplicates and retention"
      description="Both lists are proposals. A person decides on each one."
    >
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      <div
        className="mb-4 flex gap-1 border-b border-border pb-2"
        role="tablist"
      >
        {(["duplicates", "retention"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded px-2 py-1 text-small ${
              view === v
                ? "bg-brand/10 font-medium text-brand-dark"
                : "text-ink-muted hover:bg-surface-sunken"
            }`}
          >
            {v === "duplicates"
              ? "Possible duplicates"
              : "Retention candidates"}
          </button>
        ))}
      </div>

      {view === "duplicates" && (
        <>
          {duplicates.loading && <Loading />}
          {(duplicates.data?.groups?.length ?? 0) === 0 &&
            !duplicates.loading && (
              <EmptyState
                title="No likely duplicates"
                body="Records are compared on normalised phone number, and on name plus date of birth."
              />
            )}
          <div className="space-y-3">
            {(duplicates.data?.groups ?? []).map((g: any, i: number) => (
              <Panel
                key={i}
                title={g.matchedOn}
                description={`${g.confidence} confidence`}
              >
                <ul className="space-y-2">
                  {g.records.map((r: any) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
                    >
                      <button
                        className="text-left text-small text-ink hover:underline"
                        onClick={() => onOpenPatient(r.id)}
                      >
                        <span className="font-medium">{r.fullName}</span>
                        <span className="text-ink-subtle">
                          {" "}
                          · {r.patientCode} · {r.phone ?? "no phone"} · created{" "}
                          {shortDate(r.createdAt)}
                        </span>
                      </button>
                      {r.id !== g.records[0].id && (
                        <button
                          className="btn-quiet btn-sm"
                          disabled={busy}
                          onClick={() =>
                            merge(r.id, g.records[0].id, r.patientCode)
                          }
                        >
                          Merge into {g.records[0].patientCode}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-caption text-ink-subtle">
                  The oldest record survives by default. Merging repoints
                  prescriptions, dispensings, sales, returns, consents and
                  controlled-register entries, and combines allergies rather
                  than dropping them.
                </p>
              </Panel>
            ))}
          </div>
        </>
      )}

      {view === "retention" && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <label className="label mb-0" htmlFor="retention-years">
              Retention period
            </label>
            <select
              id="retention-years"
              className="input w-auto py-1 text-small"
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            >
              {[3, 5, 7, 10].map((y) => (
                <option key={y} value={y}>
                  {y} years
                </option>
              ))}
            </select>
          </div>
          {retention.loading && <Loading />}
          {(retention.data?.candidates?.length ?? 0) === 0 &&
            !retention.loading && (
              <EmptyState
                title="No dormant records"
                body="Nothing has been inactive for the whole retention period."
              />
            )}
          <ul className="space-y-2">
            {(retention.data?.candidates ?? []).map((c: any) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
              >
                <div className="text-small">
                  <button
                    className="font-medium text-ink hover:underline"
                    onClick={() => onOpenPatient(c.id)}
                  >
                    {c.patientCode}
                  </button>
                  <span className="text-ink-subtle">
                    {" "}
                    · created {shortDate(c.createdAt)} · {c.prescriptions}{" "}
                    prescription(s) · {c.sales} sale(s)
                  </span>
                  {c.blocked && (
                    <div className="text-caption text-danger">
                      Outstanding balance {c.outstandingBalance} — settle or
                      write it off first, or the debt loses its owner.
                    </div>
                  )}
                </div>
                <button
                  className="btn-quiet btn-sm"
                  disabled={busy || c.blocked}
                  onClick={() => anonymize(c.id, c.patientCode)}
                >
                  Anonymise
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}
