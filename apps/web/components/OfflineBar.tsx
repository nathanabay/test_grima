"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface QueuedMutation {
  id: string;
  url: string;
  method: string;
  body: string;
  queuedAt: string;
}

const QUEUE_KEY = "pharmacore.offlineQueue";

function readQueue(): QueuedMutation[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedMutation[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Storage may be unavailable; the banner still reports connectivity.
  }
}

/**
 * Offline banner and manual sync queue (§51).
 *
 * Queued writes are replayed only when the operator presses Send — never
 * automatically. A dispense or stock movement replayed silently minutes later
 * can oversell stock the pharmacy no longer has, so each queued action is
 * shown, sent one at a time, and any conflict is surfaced rather than retried.
 */
export function OfflineBar() {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<
    Array<{ id: string; ok: boolean; message: string }>
  >([]);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueue(readQueue());

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Register the worker, and listen for writes it had to queue.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "QUEUE_MUTATION") {
        setQueue((current) => {
          const next = [...current, event.data.entry];
          writeQueue(next);
          return next;
        });
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  const send = useCallback(async () => {
    setSending(true);
    setResults([]);
    const outcomes: Array<{ id: string; ok: boolean; message: string }> = [];
    const remaining: QueuedMutation[] = [];

    // One at a time and in order: a later movement may depend on an earlier one.
    for (const item of queue) {
      try {
        const path = new URL(item.url).pathname.replace(/^\/api/, "");
        await api(path, {
          method: item.method,
          body: item.body ? JSON.parse(item.body) : undefined,
        });
        outcomes.push({
          id: item.id,
          ok: true,
          message: `${item.method} ${path} accepted`,
        });
      } catch (e: any) {
        // Conflicts are reported, never silently discarded or retried.
        outcomes.push({
          id: item.id,
          ok: false,
          message: e.message ?? "Rejected",
        });
        remaining.push(item);
      }
    }

    setResults(outcomes);
    setQueue(remaining);
    writeQueue(remaining);
    setSending(false);
  }, [queue]);

  if (online && queue.length === 0 && results.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {!online && (
        <div className="rounded-md border border-warn/40 bg-warn-light px-3 py-2 text-sm text-warn">
          <strong>Offline.</strong> Figures on screen may be from cache. Stock
          movements you make now are queued and will not be sent until you
          review them below.
        </div>
      )}

      {queue.length > 0 && (
        <div className="rounded-md border border-info/40 bg-info-light px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-info">
              <strong>{queue.length} action(s) waiting to be sent.</strong>{" "}
              Nothing is replayed automatically.
            </span>
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={!online || sending}
                onClick={send}
              >
                {sending ? "Sending..." : "Review and send"}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  if (
                    window.confirm(
                      `Discard ${queue.length} queued action(s)? They will not be sent.`,
                    )
                  ) {
                    setQueue([]);
                    writeQueue([]);
                  }
                }}
              >
                Discard
              </button>
            </div>
          </div>
          <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
            {queue.map((q) => (
              <li key={q.id}>
                {q.method} {new URL(q.url).pathname} — queued{" "}
                {new Date(q.queuedAt).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-md border border-surface-border bg-white px-3 py-2 text-xs">
          {results.map((r) => (
            <div key={r.id} className={r.ok ? "text-ok" : "text-danger"}>
              {r.ok ? "✓" : "✕"} {r.message}
            </div>
          ))}
          <button className="btn-ghost mt-2" onClick={() => setResults([])}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
