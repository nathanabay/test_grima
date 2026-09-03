"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

/** Toast notifications and confirmation dialogs (§69). */

interface Toast {
  id: number;
  tone: "ok" | "danger" | "info";
  message: string;
}

/**
 * One input in a `prompt` dialog.
 *
 * Twenty-one values were captured through `window.prompt`, including a payment
 * amount, a received quantity and the witness to a drug disposal. A browser
 * prompt has one untyped field, no label, no validation, no way to correct a
 * typo before it posts, and no way to say what the value is for. These are
 * regulated records; they deserve a form.
 */
export interface PromptField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "select";
  /** For `type: "select"`. */
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  hint?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  min?: string | number;
  max?: string | number;
  step?: string;
  /** Returns a message when the value is not acceptable, else null. */
  validate?: (value: string, all: Record<string, string>) => string | null;
}

interface FeedbackApi {
  toast: (message: string, tone?: Toast["tone"]) => void;
  /** Resolves true when the user confirms. Destructive actions must use it. */
  confirm: (options: {
    title: string;
    body?: ReactNode;
    confirmLabel?: string;
    tone?: "danger" | "primary";
    /** When set, the user must type a reason, which is returned. */
    requireReason?: string;
  }) => Promise<{ confirmed: boolean; reason?: string }>;
  /**
   * Ask for one or more values in a labelled, validated dialog.
   *
   * Resolves to the values, or null when the reader cancels. Every field is
   * checked before the dialog closes, so a bad amount is corrected here rather
   * than rejected by the server after it has been sent.
   */
  prompt: (options: {
    title: string;
    body?: ReactNode;
    confirmLabel?: string;
    tone?: "danger" | "primary";
    fields: PromptField[];
  }) => Promise<Record<string, string> | null>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (!context)
    throw new Error("useFeedback must be used inside FeedbackProvider");
  return context;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<
    | (Parameters<FeedbackApi["confirm"]>[0] & {
        resolve: (value: { confirmed: boolean; reason?: string }) => void;
      })
    | null
  >(null);
  const [reason, setReason] = useState("");

  const toast = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    // Long enough to read a sentence, short enough not to stack up.
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      5000,
    );
  }, []);

  const confirm = useCallback<FeedbackApi["confirm"]>((options) => {
    setReason("");
    return new Promise((resolve) => setDialog({ ...options, resolve }));
  }, []);

  const [form, setForm] = useState<
    | (Parameters<FeedbackApi["prompt"]>[0] & {
        resolve: (value: Record<string, string> | null) => void;
      })
    | null
  >(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const prompt = useCallback<FeedbackApi["prompt"]>((options) => {
    setValues(
      Object.fromEntries(
        options.fields.map((f) => [f.name, f.defaultValue ?? ""]),
      ),
    );
    setErrors({});
    return new Promise((resolve) => setForm({ ...options, resolve }));
  }, []);

  function submitForm() {
    if (!form) return;
    const found: Record<string, string> = {};
    for (const field of form.fields) {
      const value = (values[field.name] ?? "").trim();
      if (field.required && !value) {
        found[field.name] = `${field.label} is required`;
        continue;
      }
      if (value && field.type === "number" && Number.isNaN(Number(value))) {
        found[field.name] = "Enter a number";
        continue;
      }
      const message = field.validate?.(value, values);
      if (message) found[field.name] = message;
    }
    setErrors(found);
    // Every field is reported at once, so the reader fixes the form in one
    // pass rather than discovering the next problem after each attempt.
    if (Object.keys(found).length) return;
    form.resolve(
      Object.fromEntries(
        form.fields.map((f) => [f.name, (values[f.name] ?? "").trim()]),
      ),
    );
    setForm(null);
  }

  function cancelForm() {
    form?.resolve(null);
    setForm(null);
  }

  function close(confirmed: boolean) {
    if (!dialog) return;
    dialog.resolve({ confirmed, reason: reason.trim() || undefined });
    setDialog(null);
  }

  const reasonMissing =
    Boolean(dialog?.requireReason) && reason.trim().length === 0;

  return (
    <FeedbackContext.Provider value={{ toast, confirm, prompt }}>
      {children}

      <div
        className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md border px-3 py-2 text-sm shadow-lg ${
              t.tone === "danger"
                ? "border-danger/30 bg-danger-light text-danger"
                : t.tone === "info"
                  ? "border-info/30 bg-info-light text-info"
                  : "border-ok/30 bg-ok-light text-ok"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {form && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={form.title}
        >
          <form
            className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl"
            onSubmit={(e) => {
              e.preventDefault();
              submitForm();
            }}
          >
            <h2 className="text-base font-semibold text-ink">{form.title}</h2>
            {form.body && (
              <div className="mt-2 text-sm text-ink-muted">{form.body}</div>
            )}

            <div className="mt-3 space-y-3">
              {form.fields.map((field, i) => {
                const id = `prompt-${field.name}`;
                const error = errors[field.name];
                const common = {
                  id,
                  className: "input",
                  value: values[field.name] ?? "",
                  autoFocus: i === 0,
                  placeholder: field.placeholder,
                  "aria-invalid": error ? true : undefined,
                  "aria-describedby": error ? `${id}-error` : undefined,
                  onChange: (
                    e: React.ChangeEvent<
                      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
                    >,
                  ) =>
                    setValues((v) => ({ ...v, [field.name]: e.target.value })),
                };
                return (
                  <div key={field.name}>
                    <label className="label" htmlFor={id}>
                      {field.label}
                      {field.required && (
                        <span className="ml-0.5 text-danger" aria-hidden>
                          *
                        </span>
                      )}
                    </label>
                    {field.type === "textarea" ? (
                      <textarea {...common} rows={3} />
                    ) : field.type === "select" ? (
                      <select {...common}>
                        <option value="">Choose one</option>
                        {(field.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...common}
                        type={field.type ?? "text"}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                      />
                    )}
                    {error ? (
                      <span
                        id={`${id}-error`}
                        className="mt-1 block text-small text-danger"
                        role="alert"
                      >
                        {error}
                      </span>
                    ) : field.hint ? (
                      <span className="mt-1 block text-small text-ink-subtle">
                        {field.hint}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={cancelForm}>
                Cancel
              </button>
              <button
                type="submit"
                className={form.tone === "danger" ? "btn-danger" : "btn-primary"}
              >
                {form.confirmLabel ?? "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={dialog.title}
        >
          <div className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl">
            <h2 className="text-base font-semibold text-ink">{dialog.title}</h2>
            {dialog.body && (
              <div className="mt-2 text-sm text-ink-muted">{dialog.body}</div>
            )}

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
              <button
                type="button"
                className="btn-ghost"
                onClick={() => close(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  dialog.tone === "danger" ? "btn-danger" : "btn-primary"
                }
                onClick={() => close(true)}
                disabled={reasonMissing}
                title={reasonMissing ? "A reason is required" : undefined}
              >
                {dialog.confirmLabel ?? "Confirm"}
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
