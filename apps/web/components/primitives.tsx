"use client";

import { ReactNode, useEffect, useRef } from "react";

/**
 * The primitives every screen composes (§45–§50).
 *
 * A screen uses these rather than inventing its own empty state or its own
 * drawer, which is how a product ends up looking like six products.
 */

export function Card({
  title,
  description,
  action,
  children,
  padded = true,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-section text-ink">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-small text-ink-muted">{description}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  breadcrumb,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-4">
      {breadcrumb && (
        <div className="mb-1 text-small text-ink-subtle">{breadcrumb}</div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-1 max-w-3xl text-small text-ink-muted">
              {subtitle}
            </p>
          )}
        </div>
        {action && (
          <div className="flex flex-wrap items-center gap-2">{action}</div>
        )}
      </div>
    </div>
  );
}

/**
 * An empty state says what belongs here, why it might be empty, and what the
 * reader can do about it (§47). "No data" tells somebody nothing.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && (
        <div className="text-ink-subtle" aria-hidden>
          {icon}
        </div>
      )}
      <p className="text-section text-ink">{title}</p>
      {body && <p className="max-w-md text-small text-ink-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * An error says what happened, what is still safe, and what to try next (§49).
 * It never shows a stack trace.
 */
export function ErrorState({
  message,
  hint,
  onRetry,
  requestId,
}: {
  message: string;
  hint?: ReactNode;
  onRetry?: () => void;
  requestId?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded border border-danger/30 bg-danger-light px-4 py-3 text-body text-danger"
    >
      <p className="font-medium">{message}</p>
      {hint && <p className="mt-1 text-small opacity-90">{hint}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {onRetry && (
          <button className="btn-ghost btn-sm" onClick={onRetry}>
            Try again
          </button>
        )}
        {requestId && (
          <code className="text-caption opacity-75">Reference {requestId}</code>
        )}
      </div>
    </div>
  );
}

export function Skeleton({
  rows = 5,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-ink-subtle/15"
          style={{ width: `${88 - (i % 4) * 12}%` }}
        />
      ))}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2 px-1 py-6 text-small text-ink-muted"
      role="status"
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      {label}…
    </div>
  );
}

/**
 * A figure that leads somewhere. Dashboard numbers are entry points, not
 * decoration (§70), so a Stat with an href is a link and reads as one.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "info";
  href?: string;
  onClick?: () => void;
}) {
  const valueTone =
    tone === "danger"
      ? "text-danger"
      : tone === "warn"
        ? "text-warn"
        : tone === "ok"
          ? "text-ok"
          : tone === "info"
            ? "text-info"
            : "text-ink";

  const body = (
    <>
      <div className="text-caption uppercase text-ink-muted">{label}</div>
      <div className={`mt-1 num text-2xl font-semibold ${valueTone}`}>
        {value}
      </div>
      {/* Muted rather than subtle: the sub line is meaningful content, and a
          tile with a tinted background (a tone is a 10% wash of its colour)
          darkens the ground enough to push subtle under the AA floor. */}
      {sub && <div className="mt-1 text-small text-ink-muted">{sub}</div>}
    </>
  );

  const shell = "card h-full p-3 text-left transition-shadow duration-state";
  if (href) {
    return (
      <a href={href} className={`${shell} block hover:shadow-panel`}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${shell} w-full hover:shadow-panel`}
      >
        {body}
      </button>
    );
  }
  return <div className={shell}>{body}</div>;
}

/**
 * Contextual detail beside the list it came from (§46), so the reader keeps
 * their place. Escape closes it and focus returns where it was.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg" | "xl";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Put focus back where the reader left it, or the page loses their place.
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const w =
    width === "xl" ? "max-w-3xl" : width === "lg" ? "max-w-2xl" : "max-w-lg";

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`relative flex h-full w-full ${w} flex-col bg-surface shadow-overlay
                    outline-none animate-[slideIn_240ms_ease-out]`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-section text-ink">{title}</h2>
            {description && (
              <p className="mt-0.5 text-small text-ink-muted">{description}</p>
            )}
          </div>
          <button
            className="btn-quiet btn-sm"
            onClick={onClose}
            aria-label="Close panel"
          >
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <footer className="border-t border-border px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

/** A toolbar above a table: filters left, actions right, wrapping on mobile. */
export function Toolbar({
  children,
  actions,
}: {
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** A labelled field, so forms do not each invent their own label placement. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-small text-danger" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-small text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  );
}
