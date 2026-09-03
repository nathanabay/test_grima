"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api, money, shortDate } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Stat } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { useFeedback } from "@/components/Feedback";

type Tab = "accounts" | "journal" | "trial" | "valuation" | "notes" | "periods";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "accounts", label: "Chart of accounts" },
  { key: "journal", label: "Journal" },
  { key: "trial", label: "Trial balance" },
  { key: "valuation", label: "Stock valuation" },
  { key: "notes", label: "Credit & debit notes" },
  { key: "periods", label: "Periods" },
];

const STATUS_TONE: Record<
  string,
  "ok" | "warn" | "danger" | "neutral" | "info"
> = {
  POSTED: "ok",
  DRAFT: "warn",
  REVERSED: "danger",
  ISSUED: "ok",
  APPLIED: "info",
  CANCELLED: "neutral",
};

export default function AccountingPage() {
  const { toast, confirm } = useFeedback();
  const [tab, setTab] = useState<Tab>("accounts");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const accounts = useApi<any[]>(
    tab === "accounts" ? "/accounting/accounts?includeInactive=true" : null,
    [version],
  );
  const mapping = useApi<any[]>("/accounting/accounts/mapping-health", [
    version,
  ]);
  // The journal is the ledger of record and grows with every posting. Handing
  // the table the newest hundred made its pager stop at an arbitrary line.
  const journal = usePaged<any>(tab === "journal" ? "/accounting/journal" : null, {
    filters: version ? `v=${version}` : "",
    pageSize: 50,
  });
  const entry = useApi<any>(
    selectedEntry ? `/accounting/journal/${selectedEntry}` : null,
    [selectedEntry, version],
  );
  const trial = useApi<any>(
    tab === "trial"
      ? `/accounting/trial-balance${from || to ? `?${from ? `from=${from}` : ""}${from && to ? "&" : ""}${to ? `to=${to}` : ""}` : ""}`
      : null,
    [version, from, to],
  );
  const valuation = useApi<any>(
    tab === "valuation" ? "/accounting/valuation" : null,
    [version],
  );
  const reconciliation = useApi<any>(
    tab === "valuation" ? "/accounting/valuation/reconciliation" : null,
    [version],
  );
  const unposted = useApi<any>("/accounting/unposted?limit=50", [version]);
  const notes = useApi<any[]>(tab === "notes" ? "/accounting/notes" : null, [
    version,
  ]);
  const periods = useApi<any[]>(
    tab === "periods" ? "/accounting/periods" : null,
    [version],
  );

  const unmapped = (mapping.data ?? []).filter((m) => m.problem);

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

  async function reverse(e: any) {
    const { confirmed, reason } = await confirm({
      title: `Reverse ${e.entryNo}?`,
      body: "A posted entry is never edited or deleted. Reversing writes the mirror image as a new entry and marks this one reversed — both stay in the ledger.",
      confirmLabel: "Reverse",
      tone: "danger",
      requireReason: "Why is this entry being reversed?",
    });
    if (!confirmed) return;
    await act(
      `/accounting/journal/${e.id}/reverse`,
      { reason },
      `${e.entryNo} reversed`,
    );
  }

  async function postPending() {
    const total = unposted.data?.total ?? 0;
    const { confirmed } = await confirm({
      title: `Post ${total} outstanding document(s)?`,
      body: "Each movement and completed sale without a journal entry is posted using the mapped accounts. Anything that cannot be posted is reported rather than skipped silently.",
      confirmLabel: "Post them",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/accounting/post-pending", {
        method: "POST",
        body: { limit: 200 },
      });
      const posted =
        result.movements + result.sales + result.invoices + result.payments;
      toast(
        `Posted ${posted} document(s): ${result.movements} movement(s), ${result.sales} sale(s), ` +
          `${result.invoices} invoice(s), ${result.payments} payment(s)`,
        result.failed ? "info" : "ok",
      );
      // Failures are shown, not swallowed — an unposted document is a real gap.
      if (result.failed) {
        setError(
          `${result.failed} document(s) could not be posted: ` +
            result.errors
              .slice(0, 3)
              .map((e: any) => `${e.type} ${e.id.slice(0, 8)} — ${e.error}`)
              .join("; "),
        );
      }
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function ensureDefaults() {
    const { confirmed } = await confirm({
      title: "Create the missing default accounts?",
      body: "Only accounts that do not already exist are created. Nothing existing is renamed, remapped or deleted.",
      confirmLabel: "Create them",
    });
    if (!confirmed) return;
    await act(
      "/accounting/accounts/ensure-defaults",
      undefined,
      "Default accounts checked",
    );
  }

  async function issueNote(note: any) {
    const { confirmed } = await confirm({
      title: `Issue ${note.noteNo}?`,
      body: `Issuing posts the note to the ledger for ${money(note.grandTotal, note.currency)}. A posted note can only be corrected by another note.`,
      confirmLabel: "Issue",
    });
    if (!confirmed) return;
    await act(
      `/accounting/notes/${note.id}/issue`,
      undefined,
      `${note.noteNo} issued`,
    );
  }

  async function closePeriod(p: any) {
    const { confirmed } = await confirm({
      title: `Close ${p.code}?`,
      body: "No entry can be posted into a closed period afterwards, and the close is refused while documents in it are still unposted. Reopening is recorded with a reason.",
      confirmLabel: "Close period",
      tone: "danger",
    });
    if (!confirmed) return;
    await act(`/accounting/periods/${p.id}/close`, undefined, "Period closed");
  }

  async function reopenPeriod(p: any) {
    const { confirmed, reason } = await confirm({
      title: `Reopen ${p.code}?`,
      body: "Reopening a closed period is an audited exception.",
      confirmLabel: "Reopen",
      tone: "danger",
      requireReason: "Why is this period being reopened?",
    });
    if (!confirmed) return;
    await act(
      `/accounting/periods/${p.id}/reopen`,
      { reason },
      "Period reopened",
    );
  }

  return (
    <Shell>
      <PageHeader
        title="Accounting"
        subtitle="Double-entry journals posted from real stock movements and sales. Physical picking stays FEFO; costing follows the configured valuation method independently."
        action={
          <button
            className="btn-ghost"
            onClick={() => setVersion((v) => v + 1)}
          >
            Refresh
          </button>
        }
      />

      {error && <ErrorBox message={error} />}

      {unmapped.length > 0 && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn-light p-3 text-sm text-warn">
          <strong>{unmapped.length} system account(s) are not mapped.</strong>{" "}
          Until they are, the documents that need them cannot be posted:{" "}
          {unmapped.map((m) => m.systemKey).join(", ")}.
          <button
            className="btn-ghost ml-3"
            disabled={busy}
            onClick={ensureDefaults}
          >
            Create the missing defaults
          </button>
        </div>
      )}

      {unposted.data?.total > 0 && (
        <div className="mb-4 rounded-md border border-info/40 bg-info-light p-3 text-sm text-info">
          <strong>
            {unposted.data.total.toLocaleString()} document(s) have no journal
            entry.
          </strong>{" "}
          {unposted.data.movementTotal.toLocaleString()} stock movement(s) and{" "}
          {unposted.data.saleTotal.toLocaleString()} sale(s). Posting runs in
          batches, so it may take more than one pass to clear the whole
          backlog.
          <button
            className="btn-ghost ml-3"
            disabled={busy}
            onClick={postPending}
          >
            Post them now
          </button>
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

      {tab === "accounts" && (
        <div className="space-y-5">
          <Card title="Chart of accounts">
            {accounts.error && <ErrorBox message={accounts.error} />}
            {accounts.loading && <Loading />}
            {accounts.data && (
              <DataTable
                rows={accounts.data}
                getKey={(a: any) => a.id}
                exportName="chart-of-accounts"
                searchPlaceholder="Search accounts"
                pageSize={30}
                empty="No accounts exist yet."
                columns={[
                  { key: "code", label: "Code", value: (a: any) => a.code },
                  { key: "name", label: "Name", value: (a: any) => a.name },
                  {
                    key: "type",
                    label: "Type",
                    value: (a: any) => a.type,
                    render: (a: any) => <Pill tone="neutral">{a.type}</Pill>,
                  },
                  {
                    key: "systemKey",
                    label: "System role",
                    value: (a: any) => a.systemKey ?? "",
                    render: (a: any) =>
                      a.systemKey ? (
                        <Pill tone="info">{a.systemKey}</Pill>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    key: "currency",
                    label: "Currency",
                    optional: true,
                    value: (a: any) => a.currency ?? "",
                  },
                  {
                    key: "active",
                    label: "Status",
                    value: (a: any) => (a.isActive ? "Active" : "Inactive"),
                    render: (a: any) => (
                      <Pill tone={a.isActive ? "ok" : "neutral"}>
                        {a.isActive ? "Active" : "Inactive"}
                      </Pill>
                    ),
                  },
                ]}
              />
            )}
          </Card>

          <Card title="System account mapping">
            <p className="mb-3 text-xs text-ink-muted">
              Postings look accounts up by role, not by code, so a pharmacy can
              number its chart however it likes. A role with nothing mapped
              blocks the documents that need it, and says which.
            </p>
            {mapping.data && (
              <DataTable
                rows={mapping.data}
                getKey={(m: any) => m.systemKey}
                pageSize={30}
                exportName="account-mapping"
                columns={[
                  {
                    key: "systemKey",
                    label: "Role",
                    value: (m: any) => m.systemKey,
                  },
                  {
                    key: "code",
                    label: "Account",
                    value: (m: any) => (m.code ? `${m.code} ${m.name}` : ""),
                    render: (m: any) =>
                      m.code ? (
                        `${m.code} — ${m.name}`
                      ) : (
                        <span className="text-danger">Not mapped</span>
                      ),
                  },
                  {
                    key: "state",
                    label: "State",
                    value: (m: any) => (m.problem ? "Problem" : "OK"),
                    render: (m: any) =>
                      m.problem ? (
                        <Pill tone="danger">Problem</Pill>
                      ) : (
                        <Pill tone="ok">Mapped</Pill>
                      ),
                  },
                  {
                    key: "problem",
                    label: "Detail",
                    value: (m: any) => m.problem ?? "",
                    render: (m: any) => (
                      <span className="text-xs text-ink-muted">
                        {m.problem ?? "—"}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {tab === "journal" && (
        <div className="space-y-5">
          <Card title="Journal entries">
            {journal.error && <ErrorBox message={journal.error} />}
            {journal.loading && <Loading />}
            {!journal.error && (
              <DataTable
                rows={journal.rows}
                server={journal.server}
                getKey={(e: any) => e.id}
                exportName="journal"
                searchPlaceholder="Search entries"
                selectedKey={selectedEntry}
                onRowClick={(e: any) =>
                  setSelectedEntry((s) => (s === e.id ? null : e.id))
                }
                empty="No journal entry has been posted."
                columns={[
                  {
                    key: "entryNo",
                    label: "Entry",
                    value: (e: any) => e.entryNo,
                  },
                  {
                    key: "entryDate",
                    label: "Date",
                    value: (e: any) => e.entryDate,
                    render: (e: any) => shortDate(e.entryDate),
                  },
                  {
                    key: "description",
                    label: "Description",
                    value: (e: any) => e.description,
                  },
                  {
                    key: "sourceType",
                    label: "Source",
                    value: (e: any) => e.sourceType,
                  },
                  {
                    key: "totalDebit",
                    label: "Amount",
                    numeric: true,
                    align: "right",
                    value: (e: any) => Number(e.totalDebit),
                    render: (e: any) => money(e.totalDebit, e.currency),
                  },
                  {
                    key: "status",
                    label: "Status",
                    value: (e: any) => e.status,
                    render: (e: any) => (
                      <Pill tone={STATUS_TONE[e.status] ?? "neutral"}>
                        {e.status}
                      </Pill>
                    ),
                  },
                  {
                    key: "reverse",
                    label: "",
                    render: (e: any) =>
                      e.status === "POSTED" ? (
                        <button
                          className="btn-ghost"
                          disabled={busy}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void reverse(e);
                          }}
                        >
                          Reverse
                        </button>
                      ) : null,
                  },
                ]}
              />
            )}
          </Card>

          {selectedEntry && entry.data && (
            <Card
              title={`${entry.data.entryNo} — lines`}
              action={
                <button
                  className="btn-ghost"
                  onClick={() => setSelectedEntry(null)}
                >
                  Close
                </button>
              }
            >
              {entry.data.reversalOf && (
                <p className="mb-3 text-xs text-ink-muted">
                  This entry reverses {entry.data.reversalOf.entryNo}.
                </p>
              )}
              {entry.data.reversals?.length > 0 && (
                <p className="mb-3 text-xs text-danger">
                  Reversed by{" "}
                  {entry.data.reversals.map((r: any) => r.entryNo).join(", ")}.
                </p>
              )}
              <DataTable
                rows={entry.data.lines}
                getKey={(l: any) => l.id}
                pageSize={50}
                exportName={`journal-${entry.data.entryNo}`}
                columns={[
                  {
                    key: "lineNumber",
                    label: "#",
                    numeric: true,
                    align: "right",
                    value: (l: any) => l.lineNumber,
                  },
                  {
                    key: "account",
                    label: "Account",
                    value: (l: any) =>
                      `${l.account?.code ?? ""} ${l.account?.name ?? ""}`,
                  },
                  {
                    key: "debit",
                    label: "Debit",
                    numeric: true,
                    align: "right",
                    value: (l: any) => Number(l.debit),
                    render: (l: any) =>
                      Number(l.debit)
                        ? money(l.debit, entry.data.currency)
                        : "",
                  },
                  {
                    key: "credit",
                    label: "Credit",
                    numeric: true,
                    align: "right",
                    value: (l: any) => Number(l.credit),
                    render: (l: any) =>
                      Number(l.credit)
                        ? money(l.credit, entry.data.currency)
                        : "",
                  },
                  {
                    key: "memo",
                    label: "Memo",
                    value: (l: any) => l.memo ?? "",
                  },
                ]}
              />
              <div className="mt-3 flex gap-6 text-sm">
                <span>
                  <span className="text-ink-subtle">Total debit</span>{" "}
                  <span className="num font-medium">
                    {money(entry.data.totalDebit, entry.data.currency)}
                  </span>
                </span>
                <span>
                  <span className="text-ink-subtle">Total credit</span>{" "}
                  <span className="num font-medium">
                    {money(entry.data.totalCredit, entry.data.currency)}
                  </span>
                </span>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "trial" && (
        <Card
          title="Trial balance"
          action={
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                className="input w-40"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="text-ink-subtle">to</span>
              <input
                type="date"
                className="input w-40"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          }
        >
          {trial.error && <ErrorBox message={trial.error} />}
          {trial.loading && <Loading />}
          {trial.data && (
            <>
              {!trial.data.balanced && (
                // Stated rather than hidden: an unbalanced ledger is the single
                // most important thing this screen can tell an accountant.
                <div className="mb-3 rounded-md border border-danger/40 bg-danger-light p-3 text-sm text-danger">
                  The ledger does not balance. Debits and credits differ by{" "}
                  {trial.data.difference}.
                </div>
              )}
              <DataTable
                rows={trial.data.rows}
                getKey={(r: any) => r.accountId}
                pageSize={50}
                exportName="trial-balance"
                searchPlaceholder="Search accounts"
                empty="Nothing has been posted in this window."
                columns={[
                  { key: "code", label: "Code", value: (r: any) => r.code },
                  { key: "name", label: "Account", value: (r: any) => r.name },
                  { key: "type", label: "Type", value: (r: any) => r.type },
                  {
                    key: "debit",
                    label: "Debit",
                    numeric: true,
                    align: "right",
                    value: (r: any) => Number(r.debit),
                    render: (r: any) => money(r.debit),
                  },
                  {
                    key: "credit",
                    label: "Credit",
                    numeric: true,
                    align: "right",
                    value: (r: any) => Number(r.credit),
                    render: (r: any) => money(r.credit),
                  },
                  {
                    key: "balance",
                    label: "Balance",
                    numeric: true,
                    align: "right",
                    value: (r: any) => Number(r.balance),
                    render: (r: any) => (
                      <span
                        className={Number(r.balance) < 0 ? "text-danger" : ""}
                      >
                        {money(r.balance)}{" "}
                        <span className="text-[10px] text-ink-subtle">
                          {r.normalSide}
                        </span>
                      </span>
                    ),
                  },
                ]}
              />
              <div className="mt-3 flex flex-wrap gap-6 text-sm">
                <span>
                  <span className="text-ink-subtle">Total debit</span>{" "}
                  <span className="num font-medium">
                    {money(trial.data.totalDebit)}
                  </span>
                </span>
                <span>
                  <span className="text-ink-subtle">Total credit</span>{" "}
                  <span className="num font-medium">
                    {money(trial.data.totalCredit)}
                  </span>
                </span>
                <Pill tone={trial.data.balanced ? "ok" : "danger"}>
                  {trial.data.balanced ? "Balanced" : "Out of balance"}
                </Pill>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === "valuation" && (
        <div className="space-y-5">
          {valuation.error && <ErrorBox message={valuation.error} />}
          {valuation.loading && <Loading />}
          {valuation.data && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Stock value"
                value={money(valuation.data.totalValue)}
                sub={valuation.data.basis}
              />
              <Stat
                label="Method"
                value={valuation.data.method}
                sub="Costing only — picking stays FEFO"
              />
              <Stat label="Products valued" value={valuation.data.products} />
            </div>
          )}

          {reconciliation.error && <ErrorBox message={reconciliation.error} />}
          {reconciliation.data && (
            <Card title="Inventory account vs stock on hand">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Ledger balance"
                  value={money(reconciliation.data.ledgerBalance)}
                />
                <Stat
                  label="Stock valuation"
                  value={money(reconciliation.data.physicalValue)}
                />
                <Stat
                  label="Difference"
                  value={money(reconciliation.data.difference)}
                  tone={
                    reconciliation.data.withinTolerance ? "neutral" : "danger"
                  }
                  sub={
                    reconciliation.data.differencePercent === null
                      ? "No ledger balance to compare against"
                      : `${reconciliation.data.differencePercent}%`
                  }
                />
                <Stat
                  label="Within tolerance"
                  value={reconciliation.data.withinTolerance ? "Yes" : "No"}
                  tone={
                    reconciliation.data.withinTolerance ? "neutral" : "danger"
                  }
                />
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                {reconciliation.data.note}
              </p>
            </Card>
          )}
        </div>
      )}

      {tab === "notes" && (
        <Card title="Credit and debit notes">
          {notes.error && <ErrorBox message={notes.error} />}
          {notes.loading && <Loading />}
          {notes.data &&
            (notes.data.length === 0 ? (
              <Empty>No credit or debit note has been raised.</Empty>
            ) : (
              <DataTable
                rows={notes.data}
                getKey={(n: any) => n.id}
                exportName="finance-notes"
                searchPlaceholder="Search notes"
                columns={[
                  { key: "noteNo", label: "Note", value: (n: any) => n.noteNo },
                  {
                    key: "noteType",
                    label: "Type",
                    value: (n: any) => n.noteType,
                    render: (n: any) => (
                      <Pill tone={n.noteType === "CREDIT" ? "info" : "warn"}>
                        {n.noteType}
                      </Pill>
                    ),
                  },
                  {
                    key: "direction",
                    label: "Against",
                    value: (n: any) => n.direction,
                  },
                  {
                    key: "noteDate",
                    label: "Date",
                    value: (n: any) => n.noteDate,
                    render: (n: any) => shortDate(n.noteDate),
                  },
                  {
                    key: "reason",
                    label: "Reason",
                    value: (n: any) => n.reason,
                  },
                  {
                    key: "lines",
                    label: "Lines",
                    numeric: true,
                    align: "right",
                    optional: true,
                    value: (n: any) => n.lines?.length ?? 0,
                  },
                  {
                    key: "grandTotal",
                    label: "Total",
                    numeric: true,
                    align: "right",
                    value: (n: any) => Number(n.grandTotal),
                    render: (n: any) => money(n.grandTotal, n.currency),
                  },
                  {
                    key: "status",
                    label: "Status",
                    value: (n: any) => n.status,
                    render: (n: any) => (
                      <Pill tone={STATUS_TONE[n.status] ?? "neutral"}>
                        {n.status}
                      </Pill>
                    ),
                  },
                  {
                    key: "issue",
                    label: "",
                    render: (n: any) =>
                      n.status === "DRAFT" ? (
                        <button
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void issueNote(n)}
                        >
                          Issue
                        </button>
                      ) : null,
                  },
                ]}
              />
            ))}
        </Card>
      )}

      {tab === "periods" && (
        <Card title="Accounting periods">
          {periods.error && <ErrorBox message={periods.error} />}
          {periods.loading && <Loading />}
          {periods.data &&
            (periods.data.length === 0 ? (
              <Empty>
                No period has been opened. Without one, entries post without a
                period check.
              </Empty>
            ) : (
              <DataTable
                rows={periods.data}
                getKey={(p: any) => p.id}
                exportName="accounting-periods"
                columns={[
                  { key: "code", label: "Period", value: (p: any) => p.code },
                  {
                    key: "startDate",
                    label: "From",
                    value: (p: any) => p.startDate,
                    render: (p: any) => shortDate(p.startDate),
                  },
                  {
                    key: "endDate",
                    label: "To",
                    value: (p: any) => p.endDate,
                    render: (p: any) => shortDate(p.endDate),
                  },
                  {
                    key: "status",
                    label: "Status",
                    value: (p: any) => p.status,
                    render: (p: any) => (
                      <Pill tone={p.status === "OPEN" ? "ok" : "neutral"}>
                        {p.status}
                      </Pill>
                    ),
                  },
                  {
                    key: "actions",
                    label: "",
                    render: (p: any) =>
                      p.status === "OPEN" ? (
                        <button
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void closePeriod(p)}
                        >
                          Close
                        </button>
                      ) : (
                        <button
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void reopenPeriod(p)}
                        >
                          Reopen
                        </button>
                      ),
                  },
                ]}
              />
            ))}
        </Card>
      )}
    </Shell>
  );
}
