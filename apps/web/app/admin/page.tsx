"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { usePaged } from "@/lib/paged";
import { api, shortDate } from "@/lib/api";
import { translationCoverage } from "@/lib/i18n";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pager,
  Pill,
  Table,
} from "@/components/ui";

const TABS = [
  "Users",
  "Roles",
  "Organization",
  "Workflows",
  "Backups",
  "Audit trail",
  "Localization",
] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("Users");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Shell>
      <PageHeader
        title="Administration"
        subtitle="Users, roles, organization structure, approval chains, backups and the audit trail."
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

      <div className="mb-4 flex flex-wrap gap-1 border-b border-surface-border pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-brand-light font-medium text-brand-dark" : "text-ink-muted hover:bg-surface-sunken"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Users" && <Users onError={setError} onMessage={setMessage} />}
      {tab === "Roles" && <Roles />}
      {tab === "Organization" && <Organization />}
      {tab === "Workflows" && <Workflows />}
      {tab === "Backups" && (
        <Backups onError={setError} onMessage={setMessage} />
      )}
      {tab === "Audit trail" && <Audit />}
      {tab === "Localization" && <Localization />}
    </Shell>
  );
}

function Users({
  onError,
  onMessage,
}: {
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const users = usePaged<any>("/admin/users", { pageSize: 50 });
  const roles = useApi<any[]>("/admin/roles");
  const [creating, setCreating] = useState(false);

  return (
    <Card
      title={`${users.total.toLocaleString()} user${users.total === 1 ? "" : "s"}`}
      action={
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "Add user"}
        </button>
      }
    >
      {creating && (
        <form
          className="mb-4 grid gap-3 rounded-md border border-surface-border p-3 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const created = await api("/admin/users", {
                method: "POST",
                body: {
                  email: f.get("email"),
                  username: f.get("username"),
                  fullName: f.get("fullName"),
                  password: f.get("password"),
                  licenseNumber: f.get("licenseNumber") || undefined,
                  roleCodes: [f.get("role")],
                },
              });
              onMessage(
                `User ${created.username} created; they must change the password at first sign-in.`,
              );
              setCreating(false);
              users.refresh();
            } catch (e: any) {
              onError(e.message);
            }
          }}
        >
          <div>
            <label className="label">Full name</label>
            <input name="fullName" className="input" required />
          </div>
          <div>
            <label className="label">Username</label>
            <input name="username" className="input" required />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" required />
          </div>
          <div>
            <label className="label">Initial password</label>
            <input name="password" className="input" minLength={10} required />
          </div>
          <div>
            <label className="label">Licence number</label>
            <input name="licenseNumber" className="input" />
          </div>
          <div>
            <label className="label">Role</label>
            <select aria-label="Role" name="role" className="input">
              {(roles.data ?? []).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <button className="btn-primary">Create user</button>
          </div>
        </form>
      )}

      {users.loading && <Loading />}
      {users.rows.length ? (
        <Table
          head={[
            "Name",
            "Username",
            "Roles",
            "Scope",
            "MFA",
            "Status",
            "Last sign-in",
          ]}
        >
          {users.rows.map((u: any) => (
            <tr key={u.id}>
              <td className="td font-medium">
                {u.fullName}
                {u.licenseNumber && (
                  <div className="text-xs text-ink-subtle">
                    {u.licenseNumber}
                  </div>
                )}
              </td>
              <td className="td text-ink-muted">{u.username}</td>
              <td className="td text-xs">
                {u.roles.map((r: any) => r.role.name).join(", ")}
              </td>
              <td className="td text-xs text-ink-muted">
                {u.scopes.length
                  ? `${u.scopes.length} branch`
                  : "Organization-wide"}
              </td>
              <td className="td">
                {u.mfaEnabled ? (
                  <Pill tone="ok">on</Pill>
                ) : (
                  <Pill tone="warn">off</Pill>
                )}
              </td>
              <td className="td">
                <Pill tone={u.status === "ACTIVE" ? "ok" : "danger"}>
                  {u.status}
                </Pill>
              </td>
              <td className="td text-xs text-ink-muted">
                {shortDate(u.lastLoginAt)}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        !users.loading && <Empty>No users.</Empty>
      )}
      <Pager
        page={users.page}
        pageSize={users.pageSize}
        total={users.total}
        onPage={users.setPage}
        loading={users.loading}
        noun="user"
      />
    </Card>
  );
}

function Roles() {
  const roles = useApi<any[]>("/admin/roles");
  return (
    <Card title={`${roles.data?.length ?? 0} roles`}>
      {roles.loading && <Loading />}
      {roles.data?.length ? (
        <Table head={["Role", "Description", "Permissions", "Users", "System"]}>
          {roles.data.map((r) => (
            <tr key={r.id}>
              <td className="td font-medium">
                {r.name}
                <div className="text-xs text-ink-subtle">{r.code}</div>
              </td>
              <td className="td text-xs text-ink-muted">{r.description}</td>
              <td className="td num">{r.permissions.length}</td>
              <td className="td num">{r._count.users}</td>
              <td className="td">
                {r.isSystem ? (
                  <Pill>system</Pill>
                ) : (
                  <Pill tone="info">custom</Pill>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : null}
    </Card>
  );
}

function Organization() {
  const org = useApi<any>("/admin/organization");
  if (org.loading) return <Loading />;
  if (!org.data) return null;
  return (
    <div className="space-y-4">
      <Card title={org.data.name}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Legal name", org.data.legalName],
            ["Tax ID", org.data.taxId],
            ["Licence", org.data.licenseNumber],
            ["Currency", org.data.currency],
            ["Timezone", org.data.timezone],
            ["Valuation", org.data.valuationMethod],
            [
              "Negative stock",
              org.data.allowNegativeStock ? "allowed" : "blocked",
            ],
            ["Default locale", org.data.defaultLocale],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <dt className="text-xs text-ink-muted">{k}</dt>
              <dd className="text-sm font-medium">{v || "-"}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title={`${org.data.branches.length} branches`}>
        <Table head={["Branch", "Code", "City", "Warehouses", "Locations"]}>
          {org.data.branches.map((b: any) => (
            <tr key={b.id}>
              <td className="td font-medium">
                {b.name}
                {b.isHeadOffice && <Pill tone="brand"> head office</Pill>}
              </td>
              <td className="td text-ink-muted">{b.code}</td>
              <td className="td text-ink-muted">{b.city}</td>
              <td className="td num">{b.warehouses.length}</td>
              <td className="td num">
                {b.warehouses.reduce(
                  (s: number, w: any) => s + w.locations.length,
                  0,
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function Workflows() {
  const defs = useApi<any[]>("/workflows/definitions");
  return (
    <Card title="Approval chains">
      {defs.loading && <Loading />}
      {defs.data?.length ? (
        <div className="space-y-3">
          {defs.data.map((d) => (
            <div
              key={d.id}
              className="rounded-md border border-surface-border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{d.name}</span>
                <Pill tone={d.isActive ? "ok" : "neutral"}>
                  {d.isActive ? "active" : "inactive"}
                </Pill>
              </div>
              <div className="text-xs text-ink-subtle">
                {d.documentType.replace(/_/g, " ")} · {d.code}
              </div>
              <ol className="mt-2 space-y-1 text-xs">
                {d.steps.map((s: any) => (
                  <li
                    key={s.step}
                    className="rounded bg-surface-sunken px-2 py-1"
                  >
                    <span className="font-medium">
                      Step {s.step}: {s.name}
                    </span>
                    <span className="text-ink-muted">
                      {" "}
                      — needs {s.requiredPermission}
                    </span>
                    {s.minAmount !== undefined && (
                      <span className="text-ink-muted">
                        {" "}
                        · only above {s.minAmount}
                      </span>
                    )}
                    {s.controlledOnly && (
                      <span className="text-ink-muted">
                        {" "}
                        · controlled medicines only
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        !defs.loading && <Empty>No approval chains configured.</Empty>
      )}
    </Card>
  );
}

function Backups({
  onError,
  onMessage,
}: {
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const status = useApi<any>("/admin/backups");
  const [busy, setBusy] = useState(false);

  const HEALTH_TONE: Record<string, any> = {
    OK: "ok",
    STALE: "warn",
    NO_BACKUP: "danger",
    LAST_RUN_FAILED: "danger",
  };

  return (
    <Card
      title="Backups"
      action={
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api("/admin/backups", { method: "POST" });
              onMessage(`Backup ${r.fileName} completed.`);
              status.refresh();
            } catch (e: any) {
              onError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Backing up..." : "Back up now"}
        </button>
      }
    >
      {status.loading && <Loading />}
      {status.data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-3">
              <div className="text-xs text-ink-muted">Health</div>
              <div className="mt-1">
                <Pill tone={HEALTH_TONE[status.data.health]}>
                  {status.data.health.replace(/_/g, " ")}
                </Pill>
              </div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-ink-muted">Last successful</div>
              <div className="text-sm font-medium">
                {status.data.lastSuccessfulBackup
                  ? shortDate(status.data.lastSuccessfulBackup.completedAt)
                  : "never"}
              </div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-ink-muted">Next scheduled</div>
              <div className="text-sm font-medium">
                {new Date(status.data.nextScheduledBackup).toLocaleString()}
              </div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-ink-muted">Retention</div>
              <div className="text-sm font-medium">
                {status.data.retentionDays} days
              </div>
            </div>
          </div>

          {!status.data.configured && (
            <div className="mb-3 rounded-md border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger">
              BACKUP_ENCRYPTION_KEY is not set. Backups contain patient and
              controlled-drug records and will not be written unencrypted.
            </div>
          )}

          <Table head={["File", "Status", "Size", "Verified", "Started", ""]}>
            {status.data.history.map((b: any) => (
              <tr key={b.id}>
                <td className="td text-xs">{b.fileName}</td>
                <td className="td">
                  <Pill
                    tone={
                      b.status === "SUCCESS"
                        ? "ok"
                        : b.status === "FAILED"
                          ? "danger"
                          : "warn"
                    }
                  >
                    {b.status}
                  </Pill>
                </td>
                <td className="td num">
                  {b.sizeBytes ? `${Math.round(b.sizeBytes / 1024)} KB` : "-"}
                </td>
                <td className="td text-xs">
                  {b.verifiedAt ? (
                    <Pill tone="ok">verified</Pill>
                  ) : (
                    <span className="text-ink-subtle">not verified</span>
                  )}
                </td>
                <td className="td text-xs text-ink-muted">
                  {new Date(b.startedAt).toLocaleString()}
                </td>
                <td className="td">
                  {b.status === "SUCCESS" && (
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(`/admin/backups/${b.id}/verify`, {
                            method: "POST",
                          });
                          onMessage(
                            "Backup verified — it decrypts end to end.",
                          );
                          status.refresh();
                        } catch (e: any) {
                          onError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Verify
                    </button>
                  )}
                  {b.errorMessage && (
                    <div className="text-xs text-danger">
                      {b.errorMessage.slice(0, 80)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Card>
  );
}

function Audit() {
  const logs = usePaged<any>("/admin/audit-logs", { pageSize: 50 });
  const verify = useApi<any>("/admin/audit-logs/verify");
  return (
    <Card
      title={`Audit trail — ${logs.total.toLocaleString()} ${logs.total === 1 ? "entry" : "entries"}`}
      action={
        verify.data && (
          <Pill tone={verify.data.valid ? "ok" : "danger"}>
            {verify.data.valid
              ? `hash chain verified (${verify.data.checked} rows)`
              : `chain broken at ${verify.data.brokenAtSequence}`}
          </Pill>
        )
      }
    >
      {logs.loading && <Loading />}
      {logs.rows.length ? (
        <Table
          head={["Seq", "When", "User", "Module", "Action", "Entity", "Reason"]}
        >
          {logs.rows.map((l: any) => (
            <tr key={l.id}>
              <td className="td num text-xs">{l.sequence}</td>
              <td className="td text-xs text-ink-muted">
                {new Date(l.createdAt).toLocaleString()}
              </td>
              <td className="td text-xs">{l.userLabel ?? "system"}</td>
              <td className="td text-xs">{l.module}</td>
              <td className="td text-xs font-medium">{l.action}</td>
              <td className="td text-xs text-ink-muted">
                {l.entityType ?? "-"}
              </td>
              <td className="td text-xs text-ink-muted">{l.reason ?? ""}</td>
            </tr>
          ))}
        </Table>
      ) : null}
      <Pager
        page={logs.page}
        pageSize={logs.pageSize}
        total={logs.total}
        onPage={logs.setPage}
        loading={logs.loading}
        noun="entry"
        plural="entries"
      />
    </Card>
  );
}

function Localization() {
  const coverage = translationCoverage();
  return (
    <Card title="Translation coverage">
      <Table head={["Locale", "Translated", "Total keys", "Coverage"]}>
        {coverage.map((c) => (
          <tr key={c.locale}>
            <td className="td font-medium">{c.locale}</td>
            <td className="td num">{c.translated}</td>
            <td className="td num">{c.total}</td>
            <td className="td">
              <div className="flex items-center gap-2">
                <span className="h-2 w-32 rounded bg-surface-sunken">
                  <span
                    className="block h-full rounded bg-brand"
                    style={{ width: `${c.pct}%` }}
                  />
                </span>
                <span className="num text-xs">{c.pct}%</span>
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-xs text-ink-subtle">
        Navigation and app chrome are translated. Individual page copy is not
        yet extracted into the catalogues, so those strings still render in
        English regardless of the selected locale.
      </p>
    </Card>
  );
}
