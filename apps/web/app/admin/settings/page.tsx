"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill } from "@/components/ui";
import { useFeedback } from "@/components/Feedback";

interface SettingRow {
  key: string;
  group: string;
  label: string;
  description: string;
  type: "number" | "boolean" | "string" | "string[]" | "number[]";
  default: unknown;
  value: unknown;
  isOverridden: boolean;
  min?: number;
  max?: number;
  options?: string[];
  /** Set when the value is declared but nothing reads it yet. */
  notEnforced?: string | null;
}

interface FlagRow {
  key: string;
  group: string;
  label: string;
  description: string;
  value: unknown;
  isOverridden: boolean;
  requires?: string;
  unavailableReason: string | null;
  notEnforced?: string | null;
}

/** Render a stored value the way it will be typed back in. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export default function SettingsPage() {
  const { toast, confirm } = useFeedback();
  const [version, setVersion] = useState(0);
  const config = useApi<{ settings: SettingRow[]; features: FlagRow[] }>(
    "/admin/config",
    [version],
  );

  // Only edited rows are sent, so an untouched setting is never rewritten with
  // a value the operator did not choose.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>("all");

  useEffect(() => setDraft({}), [version]);

  const groups = useMemo(() => {
    const set = new Set((config.data?.settings ?? []).map((s) => s.group));
    return ["all", ...Array.from(set).sort()];
  }, [config.data]);

  const visible = (config.data?.settings ?? []).filter(
    (s) => group === "all" || s.group === group,
  );

  const dirty = Object.keys(draft);

  async function save() {
    if (!dirty.length) return;
    setBusy(true);
    setError(null);
    try {
      const values: Record<string, unknown> = {};
      for (const key of dirty) {
        const def = config.data!.settings.find((s) => s.key === key)!;
        const raw = draft[key];
        values[key] =
          def.type === "boolean"
            ? raw === "true"
            : def.type === "number"
              ? Number(raw)
              : raw; // Lists and strings are coerced and validated server-side.
      }
      // The endpoint answers with the freshly resolved configuration, which the
      // reload below picks up, so nothing here has to guess at the new values.
      await api("/admin/config", { method: "PATCH", body: { values } });
      toast(`Saved ${dirty.length} setting(s)`, "ok");
      setVersion((v) => v + 1);
    } catch (e: any) {
      // The server validates ranges and option lists; show exactly what it said.
      setError(e.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function reset(row: SettingRow) {
    const { confirmed } = await confirm({
      title: `Reset ${row.label}?`,
      body: `The value returns to the built-in default (${asText(row.default) || "empty"}).`,
      confirmLabel: "Reset",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/admin/config/${encodeURIComponent(row.key)}/reset`, {
        method: "POST",
      });
      toast(`${row.label} reset to default`, "ok");
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleFlag(flag: FlagRow, next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api("/admin/config", {
        method: "PATCH",
        body: { values: { [flag.key]: next } },
      });
      toast(`${flag.label} ${next ? "enabled" : "disabled"}`, "ok");
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
        title="System configuration"
        subtitle="Operational rules live here rather than in code. Changes take effect on the next request; nothing is cached past it."
        action={
          <button
            className="btn-primary"
            disabled={!dirty.length || busy}
            onClick={save}
          >
            {dirty.length ? `Save ${dirty.length} change(s)` : "No changes"}
          </button>
        }
      />

      {error && <ErrorBox message={error} />}
      {config.error && <ErrorBox message={config.error} />}
      {config.loading && <Loading label="Reading configuration" />}

      {config.data && (
        <div className="space-y-5">
          <Card
            title="Feature flags"
            action={
              <span className="text-xs text-ink-subtle">
                {config.data.features.length} flags
              </span>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              {config.data.features.map((flag) => {
                const on = flag.value === true;
                const blocked = Boolean(flag.unavailableReason);
                return (
                  <div
                    key={flag.key}
                    className="rounded-md border border-surface-border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-ink">
                          {flag.label}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-muted">
                          {flag.description}
                        </div>
                      </div>
                      <button
                        className={on ? "btn-danger" : "btn-primary"}
                        disabled={busy || blocked}
                        onClick={() => toggleFlag(flag, !on)}
                      >
                        {on ? "Turn off" : "Turn on"}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Pill tone={blocked ? "warn" : on ? "ok" : "neutral"}>
                        {blocked ? "Unavailable" : on ? "On" : "Off"}
                      </Pill>
                      {flag.isOverridden && <Pill tone="info">Overridden</Pill>}
                      {flag.notEnforced && (
                        <Pill tone="warn">Not enforced</Pill>
                      )}
                      <code className="text-[11px] text-ink-subtle">
                        {flag.key}
                      </code>
                    </div>
                    {flag.notEnforced && (
                      // A flag that gates nothing says so, rather than letting
                      // the toggle imply a control that does not exist.
                      <p className="mt-2 text-xs text-warn">
                        Turning this on or off changes nothing yet.{" "}
                        {flag.notEnforced}
                      </p>
                    )}
                    {blocked && (
                      // §35: a flag whose dependency is missing stays off however
                      // it is set, and says so instead of pretending to work.
                      <p className="mt-2 text-xs text-warn">
                        {flag.unavailableReason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            title="Settings"
            action={
              <select
                className="input w-56"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g === "all" ? "All groups" : g}
                  </option>
                ))}
              </select>
            }
          >
            {visible.length === 0 ? (
              <Empty>No settings in this group.</Empty>
            ) : (
              <div className="space-y-3">
                {visible.map((row) => {
                  const current = draft[row.key] ?? asText(row.value);
                  const changed = row.key in draft;
                  return (
                    <div
                      key={row.key}
                      className={`rounded-md border p-3 ${changed ? "border-brand bg-brand-light/30" : "border-surface-border"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink">
                            {row.label}
                          </div>
                          <div className="mt-0.5 text-xs text-ink-muted">
                            {row.description}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
                            <code>{row.key}</code>
                            <span>&middot; {row.type}</span>
                            {row.min !== undefined && (
                              <span>&middot; min {row.min}</span>
                            )}
                            {row.max !== undefined && (
                              <span>&middot; max {row.max}</span>
                            )}
                            <span>
                              &middot; default {asText(row.default) || "empty"}
                            </span>
                            {row.isOverridden && (
                              <Pill tone="info">Overridden</Pill>
                            )}
                            {row.notEnforced && (
                              <Pill tone="warn">Not enforced</Pill>
                            )}
                          </div>
                          {row.notEnforced && (
                            <p className="mt-1 text-xs text-warn">
                              Changing this has no effect yet. {row.notEnforced}
                            </p>
                          )}
                        </div>

                        <div className="flex w-full items-center gap-2 sm:w-72">
                          {row.type === "boolean" ? (
                            <select
                              className="input"
                              aria-label={row.label ?? row.key}
                              value={current}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  [row.key]: e.target.value,
                                }))
                              }
                            >
                              <option value="true">On</option>
                              <option value="false">Off</option>
                            </select>
                          ) : row.options ? (
                            <select
                              className="input"
                              aria-label={row.label ?? row.key}
                              value={current}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  [row.key]: e.target.value,
                                }))
                              }
                            >
                              {row.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="input"
                              aria-label={row.label ?? row.key}
                              type={row.type === "number" ? "number" : "text"}
                              value={current}
                              placeholder={
                                row.type.endsWith("[]") ? "Comma separated" : ""
                              }
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  [row.key]: e.target.value,
                                }))
                              }
                            />
                          )}
                          {row.isOverridden && (
                            <button
                              className="btn-ghost"
                              disabled={busy}
                              onClick={() => reset(row)}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
