'use client';

import { ReactNode, createContext, useCallback, useContext, useState } from 'react';

/** Toast notifications and confirmation dialogs (§69). */

interface Toast {
  id: number;
  tone: 'ok' | 'danger' | 'info';
  message: string;
}

interface FeedbackApi {
  toast: (message: string, tone?: Toast['tone']) => void;
  /** Resolves true when the user confirms. Destructive actions must use it. */
  confirm: (options: {
    title: string;
    body?: ReactNode;
    confirmLabel?: string;
    tone?: 'danger' | 'primary';
    /** When set, the user must type a reason, which is returned. */
    requireReason?: string;
  }) => Promise<{ confirmed: boolean; reason?: string }>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside FeedbackProvider');
  return context;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<
    | (Parameters<FeedbackApi['confirm']>[0] & {
        resolve: (value: { confirmed: boolean; reason?: string }) => void;
      })
    | null
  >(null);
  const [reason, setReason] = useState('');

  const toast = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    // Long enough to read a sentence, short enough not to stack up.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);

  const confirm = useCallback<FeedbackApi['confirm']>((options) => {
    setReason('');
    return new Promise((resolve) => setDialog({ ...options, resolve }));
  }, []);

  function close(confirmed: boolean) {
    if (!dialog) return;
    dialog.resolve({ confirmed, reason: reason.trim() || undefined });
    setDialog(null);
  }

  const reasonMissing = Boolean(dialog?.requireReason) && reason.trim().length === 0;

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md border px-3 py-2 text-sm shadow-lg ${
              t.tone === 'danger'
                ? 'border-danger/30 bg-danger-light text-danger'
                : t.tone === 'info'
                  ? 'border-info/30 bg-info-light text-info'
                  : 'border-ok/30 bg-ok-light text-ok'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={dialog.title}
        >
          <div className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl">
            <h2 className="text-base font-semibold text-ink">{dialog.title}</h2>
            {dialog.body && <div className="mt-2 text-sm text-ink-muted">{dialog.body}</div>}

            {dialog.requireReason && (
              <div className="mt-3">
                <label className="label" htmlFor="confirm-reason">
                  {dialog.requireReason}
                </label>
                <textarea
                  id="confirm-reason"
                  className="input"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={dialog.tone === 'danger' ? 'btn-danger' : 'btn-primary'}
                onClick={() => close(true)}
                disabled={reasonMissing}
                title={reasonMissing ? 'A reason is required' : undefined}
              >
                {dialog.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

/** Skeleton placeholder, so a loading table does not collapse the layout. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-surface-sunken" />
      ))}
    </div>
  );
}
