"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill } from "@/components/ui";

const SEVERITY_TONE: Record<string, any> = {
  CRITICAL: "danger",
  WARNING: "warn",
  INFO: "info",
};

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const list = useApi<any[]>(`/notifications?unreadOnly=${unreadOnly}`, [
    unreadOnly,
    version,
  ]);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    try {
      await api("/notifications/read", { method: "POST", body: { ids } });
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const unread = (list.data ?? []).filter((n) => !n.readAt);

  return (
    <Shell>
      <PageHeader
        title="Notifications"
        subtitle="Low stock, expiry, cold-chain excursions, recalls, receiving exceptions and approvals."
        action={
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              onClick={() => setUnreadOnly((v) => !v)}
            >
              {unreadOnly ? "Show all" : "Unread only"}
            </button>
            {unread.length > 0 && (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => markRead(unread.map((n) => n.id))}
              >
                Mark {unread.length} read
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
      {list.loading && <Loading />}

      <Card title={`${list.data?.length ?? 0} notification(s)`}>
        {list.data?.length ? (
          <div className="space-y-2">
            {list.data.map((n) => (
              <div
                key={n.id}
                className={`rounded-md border p-3 ${n.readAt ? "border-surface-border bg-white" : "border-brand/30 bg-brand-light/30"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Pill tone={SEVERITY_TONE[n.severity] ?? "neutral"}>
                      {n.severity}
                    </Pill>
                    <span className="text-sm font-medium">{n.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-subtle">
                    <span>{new Date(n.createdAt).toLocaleString()}</span>
                    {!n.readAt && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => markRead([n.id])}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
                  {n.body}
                </p>
                <div className="mt-1 flex items-center gap-3 text-xs">
                  <span className="text-ink-subtle">
                    {n.eventType.replace(/_/g, " ").toLowerCase()}
                  </span>
                  {n.linkUrl && (
                    <a className="text-brand-dark underline" href={n.linkUrl}>
                      Open
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !list.loading && <Empty>Nothing to show.</Empty>
        )}
      </Card>
    </Shell>
  );
}
