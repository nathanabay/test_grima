"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthUser, can } from "@/lib/api";
import { NAV } from "@/components/nav";

/**
 * Keyboard navigation for the whole product, not only the till.
 *
 * `/pos` had shortcuts and no other screen did, so a pharmacist working a
 * queue reached for the mouse for every move between screens. Ctrl+K already
 * opened the command palette; this adds the two things a keyboard user expects
 * next: a way to jump somewhere directly, and a way to find out what the keys
 * are.
 *
 * - `g` then a letter goes to a page, chosen from the reader's own menu, so a
 *   cashier's `g` list holds only what a cashier may open.
 * - `?` shows the list.
 *
 * Nothing fires while the reader is typing: a `g` in a search box is a `g`.
 */
const GO_KEYS: Array<[string, string]> = [
  ["d", "/dashboard"],
  ["i", "/inventory"],
  ["p", "/dispensing"],
  ["t", "/pos"],
  ["b", "/batches"],
  ["c", "/counts"],
  ["r", "/procurement"],
  ["n", "/notifications"],
  ["a", "/approvals"],
  ["m", "/products"],
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export function Shortcuts({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [awaitingGo, setAwaitingGo] = useState(false);

  // The pages this reader may open, so `g` never offers a refusal.
  const items = NAV.flatMap((g) => g.items).filter(
    (i) => !i.permission || can(user, i.permission),
  );
  const available = GO_KEYS.map(([key, href]) => ({
    key,
    href,
    label: items.find((i) => i.href === href)?.label,
  })).filter((entry) => entry.label);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      if (e.key === "Escape") {
        setAwaitingGo(false);
        setHelpOpen(false);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (awaitingGo) {
        const match = available.find((entry) => entry.key === e.key.toLowerCase());
        setAwaitingGo(false);
        if (match) {
          e.preventDefault();
          router.push(match.href);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        e.preventDefault();
        setAwaitingGo(true);
        // A half-pressed `g` should not wait forever for its second key.
        setTimeout(() => setAwaitingGo(false), 2000);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [awaitingGo, available, router]);

  return (
    <>
      {awaitingGo && (
        <div
          className="fixed bottom-4 left-4 z-50 rounded-md border border-surface-border bg-surface px-3 py-2 text-small shadow-lg"
          role="status"
        >
          Go to&hellip; press a letter, or <kbd className="kbd">?</kbd> for the
          list
        </div>
      )}

      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-ink">
              Keyboard shortcuts
            </h2>
            <dl className="mt-3 space-y-1 text-sm">
              <Row keys="Ctrl K" label="Open the command palette" />
              <Row keys="?" label="Show this list" />
              <Row keys="Esc" label="Close whatever is open" />
              {available.map((entry) => (
                <Row
                  key={entry.key}
                  keys={`g ${entry.key}`}
                  label={`Go to ${entry.label}`}
                />
              ))}
            </dl>
            <p className="mt-3 text-small text-ink-subtle">
              Only the pages your role can open are listed. Shortcuts do not
              fire while you are typing.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setHelpOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="flex gap-1">
        {keys.split(" ").map((k) => (
          <kbd key={k} className="kbd">
            {k}
          </kbd>
        ))}
      </dd>
    </div>
  );
}
