"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api, shortDate } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pager, Pill } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { useFeedback, Skeleton } from "@/components/Feedback";

interface Rule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  triggerType: string;
  summary: string;
  isActive: boolean;
  isSystem: boolean;
  priority: number;
  cooldownHours: number;
  lastRunAt: string | null;
  lastMatchCount: number;
  conditions: {
    match?: string;
    conditions: { field: string; operator: string; value?: unknown }[];
  };
  actions: { type: string; params?: Record<string, unknown> }[];
  escalations: { afterHours: number; actions: { type: string }[] }[];
}

export default function AutomationPage() {
  const { toast, confirm } = useFeedback();
  const [selected, setSelected] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const rules = useApi<Rule[]>("/automation/rules", [version]);
  // Every rule that fires writes a run. Showing the newest fifteen with no way
  // back is how "did that rule act last Tuesday?" becomes unanswerable.
  const runs = usePaged<any>("/automation/runs", {
    filters: version ? `v=${version}` : "",
    pageSize: 15,
  });
  const escalations = useApi<any[]>("/automation/escalations", [version]);

  async function loadPreview(rule: Rule) {
    setSelected(rule);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      setPreview(await api(`/automation/rules/${rule.id}/preview?limit=10`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runRule(rule: Rule) {
    const { confirmed } = await confirm({
      title: `Run “${rule.name}” now?`,
      body: (
        <>
          This takes the rule&apos;s actions for real. Preview it first if you
          have not already — the last preview matched{" "}
          <strong>{preview?.matched ?? "an unknown number of"}</strong>{" "}
          record(s).
        </>
      ),
      confirmLabel: "Run the rule",
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const result: any = await api(`/automation/rules/${rule.id}/run`, {
        method: "POST",
      });
      toast(
        `${rule.name}: ${result.matched} matched, ${result.actionsRun} action(s) taken, ${result.suppressed} suppressed by cooldown.`,
      );
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
      toast(e.message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: Rule) {
    const turningOff = rule.isActive;
    const { confirmed } = await confirm({
      title: turningOff
        ? `Turn off “${rule.name}”?`
        : `Turn on “${rule.name}”?`,
      body: turningOff
        ? "While it is off, nothing will be notified, held or escalated by this rule."
        : "It will run on its schedule from now on.",
      tone: turningOff ? "danger" : "primary",
      confirmLabel: turningOff ? "Turn it off" : "Turn it on",
    });
    if (!confirmed) return;

    try {
      await api(`/automation/rules/${rule.id}`, {
        method: "PATCH",
        body: { isActive: !rule.isActive },
      });
      toast(`${rule.name} is now ${turningOff ? "off" : "on"}.`);
      setVersion((v) => v + 1);
      setSelected(null);
    } catch (e: any) {
      toast(e.message, "danger");
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Automation rules"
        subtitle="WHEN something is true, THEN do something about it, and ESCALATE if nobody does. Every rule can be previewed before it runs."
      />

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      <Card
        title="Rules"
        action={
          <span className="text-xs text-ink-subtle">
            Built-in rules can be retuned or switched off, but not deleted.
          </span>
        }
      >
        {rules.loading ? (
          <Skeleton rows={6} />
        ) : rules.error ? (
          <ErrorBox message={rules.error} />
        ) : (
          <DataTable
            rows={rules.data ?? []}
            getKey={(r) => r.id}
            selectedKey={selected?.id ?? null}
            searchPlaceholder="Search rules"
            exportName="automation-rules"
            onRowClick={loadPreview}
            empty="No automation rules are configured."
            columns={[
              { key: "name", label: "Rule", value: (r) => r.name },
              {
                key: "status",
                label: "Status",
                value: (r) => (r.isActive ? "On" : "Off"),
                render: (r) => (
                  <Pill tone={r.isActive ? "ok" : "neutral"}>
                    {r.isActive ? "On" : "Off"}
                  </Pill>
                ),
              },
              {
                key: "triggerType",
                label: "Trigger",
                value: (r) => r.triggerType,
              },
              {
                key: "actions",
                label: "Actions",
                value: (r) => r.actions.map((a) => a.type).join(", "),
              },
              {
                key: "escalations",
                label: "Escalates",
                value: (r) =>
                  r.escalations.length
                    ? `after ${r.escalations[0].afterHours}h`
                    : "no",
                optional: true,
              },
              {
                key: "priority",
                label: "Priority",
                value: (r) => r.priority,
                numeric: true,
                optional: true,
              },
              {
                key: "cooldownHours",
                label: "Cooldown",
                value: (r) => r.cooldownHours,
                render: (r) => `${r.cooldownHours}h`,
                numeric: true,
                optional: true,
              },
              {
                key: "lastRunAt",
                label: "Last run",
                value: (r) => r.lastRunAt ?? "",
                render: (r) =>
                  r.lastRunAt ? (
                    <span title={r.lastRunAt}>
                      {shortDate(r.lastRunAt)} · {r.lastMatchCount} matched
                    </span>
                  ) : (
                    <span className="text-ink-subtle">never</span>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {selected && (
        <Card
          className="mt-4"
          title={`${selected.name} — what it would do`}
          action={
            <div className="flex gap-2">
              <button
                className="btn-ghost"
                onClick={() => loadPreview(selected)}
                disabled={busy}
              >
                Refresh preview
              </button>
              <button className="btn-ghost" onClick={() => toggle(selected)}>
                {selected.isActive ? "Turn off" : "Turn on"}
              </button>
              <button
                className="btn-primary"
                onClick={() => runRule(selected)}
                disabled={busy || !selected.isActive}
              >
                Run now
              </button>
            </div>
          }
        >
          <p className="mb-3 rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-muted">
            {selected.summary}
          </p>
          {selected.description && (
            <p className="mb-3 text-sm text-ink-muted">
              {selected.description}
            </p>
          )}

          {busy && !preview && (
            <Loading label="Working out what this rule matches" />
          )}

          {preview && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="card p-3">
                  <div className="text-xs text-ink-muted">Records scanned</div>
                  <div className="text-lg font-semibold num">
                    {preview.scanned}
                  </div>
                </div>
                <div className="card p-3">
                  <div className="text-xs text-ink-muted">Would match</div>
                  <div
                    className={`text-lg font-semibold num ${preview.matched ? "text-warn" : ""}`}
                  >
                    {preview.matched}
                  </div>
                </div>
                <div className="card p-3 sm:col-span-2">
                  <div className="text-xs text-ink-muted">Would do</div>
                  <div className="text-sm font-medium">
                    {preview.wouldAct.join(", ") || "nothing"}
                  </div>
                </div>
              </div>

              {preview.samples.length === 0 ? (
                <Empty>Nothing currently matches this rule.</Empty>
              ) : (
                <div className="space-y-3">
                  {preview.matched > preview.samples.length && (
                    <p className="text-xs text-ink-muted">
                      Showing{" "}
                      <span className="num">{preview.samples.length}</span> of
                      the{" "}
                      <span className="num">
                        {preview.matched.toLocaleString()}
                      </span>{" "}
                      records this rule matched. A preview is a sample; running
                      the rule acts on all of them.
                    </p>
                  )}
                  {preview.samples.map((sample: any) => (
                    <div
                      key={sample.subjectId}
                      className="rounded-md border border-surface-border p-3"
                    >
                      {sample.preview.map((p: any, i: number) => (
                        <div key={i} className="mb-2">
                          <div className="text-sm font-medium text-ink">
                            {p.title ?? p.type}
                          </div>
                          {p.body && (
                            <div className="whitespace-pre-line text-sm text-ink-muted">
                              {p.body}
                            </div>
                          )}
                        </div>
                      ))}
                      <details className="text-xs text-ink-subtle">
                        <summary className="cursor-pointer">
                          Why it matched
                        </summary>
                        <ul className="mt-1 space-y-0.5">
                          {sample.conditionDetail.map((c: any, i: number) => (
                            <li key={i}>
                              {c.field} {c.operator}{" "}
                              {JSON.stringify(c.expected)} — actual{" "}
                              {JSON.stringify(c.actual)}{" "}
                              <span
                                className={
                                  c.matched ? "text-ok" : "text-danger"
                                }
                              >
                                {c.matched ? "✓" : "✗"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  ))}
                </div>
              )}

              {preview.nearMisses?.length > 0 && (
                <details className="mt-3 text-xs text-ink-subtle">
                  <summary className="cursor-pointer">
                    Records that nearly matched ({preview.nearMisses.length})
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {preview.nearMisses.map((miss: any) => (
                      <li key={miss.subjectId}>
                        {miss.conditionDetail
                          .filter((c: any) => !c.matched)
                          .map(
                            (c: any) =>
                              `${c.field} was ${JSON.stringify(c.actual)}`,
                          )
                          .join(", ")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent runs">
          {runs.loading ? (
            <Skeleton rows={4} />
          ) : !runs.rows.length ? (
            <Empty>No rule has run yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-surface-sunken">
                  <tr>
                    <th className="th">Rule</th>
                    <th className="th">When</th>
                    <th className="th text-right">Matched</th>
                    <th className="th text-right">Actions</th>
                    <th className="th text-right">Suppressed</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.rows.map((run: any) => (
                    <tr key={run.id}>
                      <td className="td">{run.rule.name}</td>
                      <td className="td">{shortDate(run.startedAt)}</td>
                      <td className="td text-right num">{run.matched}</td>
                      <td className="td text-right num">{run.actionsRun}</td>
                      <td className="td text-right num text-ink-subtle">
                        {run.suppressed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager
            page={runs.page}
            pageSize={runs.pageSize}
            total={runs.total}
            onPage={runs.setPage}
            loading={runs.loading}
            noun="run"
          />
        </Card>

        <Card
          title="Unresolved"
          action={
            <span className="text-xs text-ink-subtle">
              Subjects a rule acted on that are still open
            </span>
          }
        >
          {escalations.loading ? (
            <Skeleton rows={4} />
          ) : !escalations.data?.length ? (
            <Empty>Nothing is outstanding.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-surface-sunken">
                  <tr>
                    <th className="th">Rule</th>
                    <th className="th">Since</th>
                    <th className="th">Level</th>
                    <th className="th">Next escalation</th>
                  </tr>
                </thead>
                <tbody>
                  {escalations.data.slice(0, 20).map((e: any) => (
                    <tr key={e.id}>
                      <td className="td">{e.rule.name}</td>
                      <td className="td">{shortDate(e.firstActedAt)}</td>
                      <td className="td">
                        <Pill tone={e.level > 0 ? "danger" : "warn"}>
                          {e.status}
                        </Pill>
                      </td>
                      <td className="td text-ink-muted">
                        {e.nextDueAt
                          ? shortDate(e.nextDueAt)
                          : "no further steps"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
