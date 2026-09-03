"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api, shortDate } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Stat } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { useFeedback } from "@/components/Feedback";

type Tab = "keys" | "webhooks" | "deliveries" | "fhir";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "keys", label: "API keys" },
  { key: "webhooks", label: "Webhook endpoints" },
  { key: "deliveries", label: "Delivery log" },
  { key: "fhir", label: "FHIR exchanges" },
];

const KEY_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  ACTIVE: "ok",
  EXPIRED: "warn",
  DISABLED: "neutral",
  REVOKED: "danger",
};

const HEALTH_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  OK: "ok",
  DEGRADED: "warn",
  SUSPENDED: "danger",
  IDLE: "neutral",
};

const DELIVERY_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  DELIVERED: "ok",
  PENDING: "neutral",
  RETRYING: "warn",
  FAILED: "danger",
};

export default function IntegrationsPage() {
  const { toast, confirm } = useFeedback();
  const [tab, setTab] = useState<Tab>("keys");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [creatingHook, setCreatingHook] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [chosenScopes, setChosenScopes] = useState<string[]>([]);
  const [chosenEvents, setChosenEvents] = useState<string[]>([]);
  // Shown exactly once, then discarded. There is no way to recover it later.
  const [revealed, setRevealed] = useState<{
    label: string;
    value: string;
    note: string;
  } | null>(null);

  const keys = useApi<any[]>(tab === "keys" ? "/integrations/api-keys" : null, [
    version,
  ]);
  const permissions = useApi<any[]>(
    tab === "keys" ? "/admin/permissions" : null,
    [],
  );
  const events = useApi<{ events: string[] }>("/integrations/events", []);
  const endpoints = useApi<any[]>(
    tab === "webhooks" ? "/integrations/health" : null,
    [version],
  );
  // Delivery attempts accumulate with every webhook fired. The table's own
  // pager used to walk the newest hundred and stop there.
  const deliveries = usePaged<any>(
    tab === "deliveries" ? "/integrations/deliveries" : null,
    { filters: version ? `v=${version}` : "", pageSize: 25 },
  );
  const fhirHealth = useApi<any>(tab === "fhir" ? "/fhir/_log/health" : null, [
    version,
  ]);
  const fhirLog = usePaged<any>(tab === "fhir" ? "/fhir/_log/exchanges" : null, {
    filters: version ? `v=${version}` : "",
    pageSize: 25,
  });

  // /admin/permissions answers with Permission rows; the key stores their codes.
  const permissionCodes: string[] = (permissions.data ?? []).map(
    (p: any) => p.code,
  );

  const filteredScopes = permissionCodes.filter(
    (c) => !scopeQuery || c.toLowerCase().includes(scopeQuery.toLowerCase()),
  );

  async function createKey(form: HTMLFormElement) {
    const f = new FormData(form);
    if (!chosenScopes.length) {
      setError(
        "A key with no scopes can do nothing. Grant at least one permission.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/integrations/api-keys", {
        method: "POST",
        body: {
          name: String(f.get("name") || "").trim(),
          description: String(f.get("description") || "") || undefined,
          scopes: chosenScopes,
          rateLimit: Number(f.get("rateLimit") || 120),
          expiresInDays: f.get("expiresInDays")
            ? Number(f.get("expiresInDays"))
            : undefined,
        },
      });
      setRevealed({
        label: `API key for ${result.name}`,
        value: result.key,
        note: result.warning,
      });
      setCreatingKey(false);
      setChosenScopes([]);
      form.reset();
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(key: any) {
    const { confirmed, reason } = await confirm({
      title: `Revoke ${key.name}?`,
      body: "Every call presenting this key stops working immediately. The key row is kept so its history stays readable.",
      confirmLabel: "Revoke",
      tone: "danger",
      requireReason: "Why is this key being revoked?",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/integrations/api-keys/${key.id}/revoke`, {
        method: "POST",
        body: { reason },
      });
      toast(`${key.name} revoked`, "ok");
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createEndpoint(form: HTMLFormElement) {
    const f = new FormData(form);
    if (!chosenEvents.length) {
      setError(
        "Choose at least one event, or the endpoint would never be called.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/integrations/endpoints", {
        method: "POST",
        body: {
          name: String(f.get("name") || "").trim(),
          url: String(f.get("url") || "").trim(),
          description: String(f.get("description") || "") || undefined,
          events: chosenEvents,
        },
      });
      setRevealed({
        label: `Signing secret for ${result.name ?? "the endpoint"}`,
        value: result.secret ?? "",
        note:
          result.note ??
          "Store it now — it is not shown again. Verify the X-PharmaCore-Signature header with it.",
      });
      setCreatingHook(false);
      setChosenEvents([]);
      form.reset();
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEndpoint(endpoint: any) {
    const next = !endpoint.isActive;
    const { confirmed } = await confirm({
      title: next ? `Resume ${endpoint.name}?` : `Suspend ${endpoint.name}?`,
      body: next
        ? "Deliveries resume and the consecutive-failure counter is cleared."
        : "Nothing more is sent to this endpoint until it is resumed. Queued deliveries stay queued.",
      confirmLabel: next ? "Resume" : "Suspend",
      tone: next ? "primary" : "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/integrations/endpoints/${endpoint.id}/active`, {
        method: "POST",
        body: { isActive: next },
      });
      toast(next ? "Endpoint resumed" : "Endpoint suspended", "ok");
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function retry(delivery: any) {
    setBusy(true);
    setError(null);
    try {
      await api(`/integrations/deliveries/${delivery.id}/retry`, {
        method: "POST",
      });
      toast("Queued for another attempt", "ok");
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function drainQueue() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ sent: number; failed: number }>(
        "/integrations/process",
        { method: "POST" },
      );
      toast(
        `${result.sent} delivered, ${result.failed} failed`,
        result.failed ? "info" : "ok",
      );
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Integrations"
        subtitle="Machine callers authenticate as themselves and are held to the same permissions a person would need — an integration can never reach something no role could."
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

      {revealed && (
        <div className="mb-5 rounded-md border border-warn/40 bg-warn-light p-4">
          <div className="text-sm font-semibold text-warn">
            {revealed.label}
          </div>
          <code className="mt-2 block break-all rounded bg-white p-3 text-xs text-ink">
            {revealed.value}
          </code>
          <p className="mt-2 text-xs text-warn">{revealed.note}</p>
          <button className="btn-ghost mt-2" onClick={() => setRevealed(null)}>
            I have stored it
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

      {tab === "keys" && (
        <div className="space-y-5">
          <Card
            title="API keys"
            action={
              <button
                className="btn-primary"
                onClick={() => setCreatingKey((v) => !v)}
              >
                {creatingKey ? "Cancel" : "New key"}
              </button>
            }
          >
            {creatingKey && (
              <form
                className="mb-4 space-y-3 rounded-md border border-surface-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createKey(e.currentTarget);
                }}
              >
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="text-xs text-ink-muted">
                    Name
                    <input
                      name="name"
                      required
                      className="input mt-1"
                      placeholder="Clinic HIS"
                    />
                  </label>
                  <label className="text-xs text-ink-muted md:col-span-2">
                    Description
                    <input
                      name="description"
                      className="input mt-1"
                      placeholder="What calls with this key"
                    />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Requests / minute
                    <input
                      name="rateLimit"
                      type="number"
                      min="1"
                      defaultValue="120"
                      className="input mt-1"
                    />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Expires in (days)
                    <input
                      name="expiresInDays"
                      type="number"
                      min="1"
                      className="input mt-1"
                      placeholder="Never"
                    />
                  </label>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink">
                      Scopes ({chosenScopes.length} chosen)
                    </span>
                    <input
                      className="input w-56"
                      placeholder="Filter permissions"
                      value={scopeQuery}
                      onChange={(e) => setScopeQuery(e.target.value)}
                    />
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    You cannot grant a permission you do not hold yourself, so
                    an integration can never be used to escalate privilege.
                  </p>
                  <div className="mt-2 max-h-52 overflow-y-auto rounded border border-surface-border p-2">
                    {filteredScopes.length === 0 ? (
                      <Empty>No permission matches that filter.</Empty>
                    ) : (
                      filteredScopes.map((code) => (
                        <label
                          key={code}
                          className="flex items-center gap-2 py-0.5 text-xs text-ink-muted"
                        >
                          <input
                            type="checkbox"
                            checked={chosenScopes.includes(code)}
                            onChange={(e) =>
                              setChosenScopes((s) =>
                                e.target.checked
                                  ? [...s, code]
                                  : s.filter((x) => x !== code),
                              )
                            }
                          />
                          <code>{code}</code>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <button className="btn-primary" disabled={busy}>
                  Create key
                </button>
              </form>
            )}

            {keys.error && <ErrorBox message={keys.error} />}
            {keys.loading && <Loading />}
            {keys.data && (
              <DataTable
                rows={keys.data}
                getKey={(k: any) => k.id}
                exportName="api-keys"
                searchPlaceholder="Search keys"
                empty="No API key has been issued."
                columns={[
                  { key: "name", label: "Name", value: (k: any) => k.name },
                  {
                    key: "prefix",
                    label: "Prefix",
                    value: (k: any) => k.prefix,
                    render: (k: any) => (
                      <code className="text-xs">{k.prefix}</code>
                    ),
                  },
                  {
                    key: "status",
                    label: "Status",
                    value: (k: any) => k.status,
                    render: (k: any) => (
                      <Pill tone={KEY_TONE[k.status] ?? "neutral"}>
                        {k.status}
                      </Pill>
                    ),
                  },
                  {
                    key: "scopes",
                    label: "Scopes",
                    value: (k: any) => k.scopes.length,
                    render: (k: any) => (
                      <span
                        className="text-xs text-ink-muted"
                        title={k.scopes.join("\n")}
                      >
                        {k.scopes.length} permission(s)
                      </span>
                    ),
                  },
                  {
                    key: "rateLimit",
                    label: "Rate limit",
                    numeric: true,
                    align: "right",
                    optional: true,
                    value: (k: any) => k.rateLimit,
                  },
                  {
                    key: "usageCount",
                    label: "Calls",
                    numeric: true,
                    align: "right",
                    value: (k: any) => k.usageCount,
                  },
                  {
                    key: "lastUsedAt",
                    label: "Last used",
                    value: (k: any) => k.lastUsedAt ?? "",
                    render: (k: any) =>
                      k.lastUsedAt ? shortDate(k.lastUsedAt) : "Never",
                  },
                  {
                    key: "expiresAt",
                    label: "Expires",
                    optional: true,
                    value: (k: any) => k.expiresAt ?? "",
                    render: (k: any) =>
                      k.expiresAt ? shortDate(k.expiresAt) : "Never",
                  },
                  {
                    key: "revoke",
                    label: "",
                    render: (k: any) =>
                      k.status === "REVOKED" ? null : (
                        <button
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void revokeKey(k)}
                        >
                          Revoke
                        </button>
                      ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {tab === "webhooks" && (
        <Card
          title="Webhook endpoints"
          action={
            <button
              className="btn-primary"
              onClick={() => setCreatingHook((v) => !v)}
            >
              {creatingHook ? "Cancel" : "Register endpoint"}
            </button>
          }
        >
          {creatingHook && (
            <form
              className="mb-4 space-y-3 rounded-md border border-surface-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void createEndpoint(e.currentTarget);
              }}
            >
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs text-ink-muted">
                  Name
                  <input
                    name="name"
                    required
                    className="input mt-1"
                    placeholder="Head office ERP"
                  />
                </label>
                <label className="text-xs text-ink-muted md:col-span-2">
                  URL
                  <input
                    name="url"
                    required
                    type="url"
                    className="input mt-1"
                    placeholder="https://erp.example.org/hooks/pharmacy"
                  />
                </label>
                <label className="text-xs text-ink-muted md:col-span-3">
                  Description
                  <input name="description" className="input mt-1" />
                </label>
              </div>
              <div>
                <span className="text-xs font-medium text-ink">
                  Events ({chosenEvents.length} chosen)
                </span>
                <div className="mt-2 grid gap-1 sm:grid-cols-2 md:grid-cols-3">
                  {(events.data?.events ?? []).map((ev) => (
                    <label
                      key={ev}
                      className="flex items-center gap-2 text-xs text-ink-muted"
                    >
                      <input
                        type="checkbox"
                        checked={chosenEvents.includes(ev)}
                        onChange={(e) =>
                          setChosenEvents((s) =>
                            e.target.checked
                              ? [...s, ev]
                              : s.filter((x) => x !== ev),
                          )
                        }
                      />
                      <code>{ev}</code>
                    </label>
                  ))}
                </div>
              </div>
              <button className="btn-primary" disabled={busy}>
                Register
              </button>
            </form>
          )}

          {endpoints.error && <ErrorBox message={endpoints.error} />}
          {endpoints.loading && <Loading />}
          {endpoints.data && (
            <DataTable
              rows={endpoints.data}
              getKey={(e: any) => e.id}
              exportName="webhook-endpoints"
              empty="No endpoint is registered, so nothing is being pushed anywhere."
              columns={[
                { key: "name", label: "Name", value: (e: any) => e.name },
                {
                  key: "url",
                  label: "URL",
                  value: (e: any) => e.url,
                  render: (e: any) => <code className="text-xs">{e.url}</code>,
                },
                {
                  key: "health",
                  label: "Health",
                  value: (e: any) => e.health,
                  render: (e: any) => (
                    <Pill tone={HEALTH_TONE[e.health] ?? "neutral"}>
                      {e.health}
                    </Pill>
                  ),
                },
                {
                  key: "successRate",
                  label: "Success rate",
                  numeric: true,
                  align: "right",
                  value: (e: any) => e.successRate ?? -1,
                  render: (e: any) =>
                    e.successRate === null ? (
                      <span className="text-xs text-ink-subtle">
                        Nothing sent yet
                      </span>
                    ) : (
                      `${e.successRate}%`
                    ),
                },
                {
                  key: "delivered",
                  label: "Delivered",
                  numeric: true,
                  align: "right",
                  value: (e: any) => e.delivered,
                },
                {
                  key: "failed",
                  label: "Failed",
                  numeric: true,
                  align: "right",
                  value: (e: any) => e.failed,
                },
                {
                  key: "pending",
                  label: "Queued",
                  numeric: true,
                  align: "right",
                  value: (e: any) => e.pending,
                },
                {
                  key: "events",
                  label: "Events",
                  optional: true,
                  value: (e: any) => (e.events ?? []).join(", "),
                },
                {
                  key: "toggle",
                  label: "",
                  render: (e: any) => (
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => void toggleEndpoint(e)}
                    >
                      {e.isActive ? "Suspend" : "Resume"}
                    </button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {tab === "deliveries" && (
        <Card
          title="Delivery log"
          action={
            <button className="btn-ghost" disabled={busy} onClick={drainQueue}>
              Send everything due now
            </button>
          }
        >
          {deliveries.error && <ErrorBox message={deliveries.error} />}
          {deliveries.loading && <Loading />}
          {!deliveries.error && (
            <DataTable
              rows={deliveries.rows}
              server={deliveries.server}
              getKey={(d: any) => d.id}
              exportName="webhook-deliveries"
              searchPlaceholder="Search deliveries"
              empty="Nothing has been queued for delivery."
              columns={[
                {
                  key: "endpoint",
                  label: "Endpoint",
                  value: (d: any) => d.endpoint?.name ?? "",
                },
                { key: "event", label: "Event", value: (d: any) => d.event },
                {
                  key: "status",
                  label: "Status",
                  value: (d: any) => d.status,
                  render: (d: any) => (
                    <Pill tone={DELIVERY_TONE[d.status] ?? "neutral"}>
                      {d.status}
                    </Pill>
                  ),
                },
                {
                  key: "attempts",
                  label: "Attempts",
                  numeric: true,
                  align: "right",
                  value: (d: any) => d.attempts ?? 0,
                },
                {
                  key: "responseStatus",
                  label: "Response",
                  value: (d: any) => d.responseStatus ?? "",
                  render: (d: any) =>
                    d.responseStatus ? String(d.responseStatus) : "—",
                },
                {
                  key: "lastError",
                  label: "Last error",
                  value: (d: any) => d.lastError ?? "",
                  render: (d: any) => (
                    <span className="text-xs text-danger">
                      {d.lastError ?? ""}
                    </span>
                  ),
                },
                {
                  key: "createdAt",
                  label: "Queued",
                  value: (d: any) => d.createdAt,
                  render: (d: any) => shortDate(d.createdAt),
                },
                {
                  key: "retry",
                  label: "",
                  render: (d: any) =>
                    d.status === "FAILED" ? (
                      <button
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => void retry(d)}
                      >
                        Retry
                      </button>
                    ) : null,
                },
              ]}
            />
          )}
        </Card>
      )}

      {tab === "fhir" && (
        <div className="space-y-5">
          {fhirHealth.error && <ErrorBox message={fhirHealth.error} />}
          {fhirHealth.data && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  label="FHIR version"
                  value={fhirHealth.data.fhirVersion}
                />
                <Stat
                  label="Window"
                  value={`${fhirHealth.data.windowDays} days`}
                />
                <Stat
                  label="Resource types seen"
                  value={fhirHealth.data.resources.length}
                />
              </div>
              <Card title="Exchanges by resource type">
                {fhirHealth.data.resources.length === 0 ? (
                  <Empty>Nothing has been exchanged in the last week.</Empty>
                ) : (
                  <DataTable
                    rows={fhirHealth.data.resources}
                    getKey={(r: any) => r.resourceType}
                    pageSize={20}
                    exportName="fhir-health"
                    columns={[
                      {
                        key: "resourceType",
                        label: "Resource",
                        value: (r: any) => r.resourceType,
                      },
                      {
                        key: "accepted",
                        label: "Accepted",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.accepted,
                      },
                      {
                        key: "rejected",
                        label: "Rejected",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.rejected,
                      },
                      {
                        key: "failed",
                        label: "Failed",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.failed,
                      },
                      {
                        key: "rejectionRate",
                        label: "Rejected",
                        numeric: true,
                        align: "right",
                        value: (r: any) => r.rejectionRate,
                        render: (r: any) => (
                          <Pill
                            tone={
                              r.rejectionRate > 20
                                ? "danger"
                                : r.rejectionRate > 0
                                  ? "warn"
                                  : "ok"
                            }
                          >
                            {r.rejectionRate}%
                          </Pill>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            </>
          )}

          {fhirLog.error && <ErrorBox message={fhirLog.error} />}
          {!fhirLog.error && (
            <Card title="Exchange log">
              <DataTable
                rows={fhirLog.rows}
                server={fhirLog.server}
                getKey={(x: any) => x.id}
                exportName="fhir-exchanges"
                searchPlaceholder="Search exchanges"
                empty="No FHIR request has been recorded."
                columns={[
                  {
                    key: "direction",
                    label: "Direction",
                    value: (x: any) => x.direction,
                  },
                  {
                    key: "resourceType",
                    label: "Resource",
                    value: (x: any) => x.resourceType,
                  },
                  {
                    key: "operation",
                    label: "Operation",
                    value: (x: any) => x.operation ?? "",
                  },
                  {
                    key: "status",
                    label: "Status",
                    value: (x: any) => x.status,
                    render: (x: any) => (
                      <Pill
                        tone={
                          x.status === "ACCEPTED"
                            ? "ok"
                            : x.status === "REJECTED"
                              ? "warn"
                              : x.status === "FAILED"
                                ? "danger"
                                : "neutral"
                        }
                      >
                        {x.status}
                      </Pill>
                    ),
                  },
                  {
                    key: "externalId",
                    label: "External id",
                    optional: true,
                    value: (x: any) => x.externalId ?? "",
                  },
                  {
                    key: "issues",
                    label: "Issues",
                    value: (x: any) =>
                      Array.isArray(x.issues) ? x.issues.join("; ") : "",
                    render: (x: any) =>
                      Array.isArray(x.issues) && x.issues.length ? (
                        <span className="text-xs text-danger">
                          {x.issues.join("; ")}
                        </span>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    key: "createdAt",
                    label: "When",
                    value: (x: any) => x.createdAt,
                    render: (x: any) => shortDate(x.createdAt),
                  },
                ]}
              />
            </Card>
          )}
        </div>
      )}
    </Shell>
  );
}
