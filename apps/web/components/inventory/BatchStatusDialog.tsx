"use client";

import { useEffect, useState } from "react";
import { Drawer, Field } from "@/components/primitives";
import { ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";

/**
 * Changing a batch's status (§16).
 *
 * This replaces three `window.prompt` calls, one of which asked the reader to
 * type a quarantine category by hand from a list printed in the prompt — so a
 * typo was a 400 and a plausible-looking wrong value was worse. The categories
 * are the enum, presented as a choice.
 *
 * A release also asks for the evidence it was decided on. "Released" with no
 * certificate of analysis behind it is the record an inspector asks about and
 * nobody can answer.
 */

const QUARANTINE_REASONS = [
  { value: "QUALITY_INVESTIGATION", label: "Quality investigation" },
  { value: "DAMAGED_PACKAGING", label: "Damaged packaging" },
  { value: "TEMPERATURE_EXCURSION", label: "Temperature excursion" },
  { value: "SUSPECTED_COUNTERFEIT", label: "Suspected counterfeit" },
  { value: "RECALL", label: "Recall" },
  { value: "DOCUMENTATION_ISSUE", label: "Documentation issue" },
  { value: "SHORT_SHELF_LIFE", label: "Short shelf life" },
  { value: "REGULATORY_HOLD", label: "Regulatory hold" },
];

export type BatchAction = "release" | "quarantine" | "block";

const TITLES: Record<BatchAction, string> = {
  release: "Release the batch",
  quarantine: "Quarantine the batch",
  block: "Block the batch",
};

const DESCRIPTIONS: Record<BatchAction, string> = {
  release: "FEFO will start allocating from it as soon as this is saved.",
  quarantine: "FEFO will skip it. Stock already dispensed is not affected.",
  block: "It stays where it is and nothing may allocate from it.",
};

export function BatchStatusDialog({
  batch,
  action,
  onClose,
  onDone,
}: {
  batch: any | null;
  action: BatchAction | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [quarantineReason, setQuarantineReason] = useState("QUALITY_INVESTIGATION");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!action) return;
    setReason("");
    setEvidenceRef("");
    setQuarantineReason("QUALITY_INVESTIGATION");
    setError(null);
  }, [action, batch?.id]);

  if (!batch || !action) return null;

  async function submit() {
    setError(null);
    if (!reason.trim()) return setError("Say why. The reason is the record.");
    if (action === "release" && !evidenceRef.trim()) {
      return setError("Name the certificate of analysis or inspection record.");
    }
    setBusy(true);
    try {
      await api(`/inventory/batches/${batch.id}/${action}`, {
        method: "POST",
        body: {
          reason: reason.trim(),
          ...(action === "release" ? { evidenceRef: evidenceRef.trim() } : {}),
          ...(action === "quarantine" ? { quarantineReason } : {}),
        },
      });
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={TITLES[action]}
      description={`${batch.batchNumber} · ${batch.product?.genericName ?? ""}`}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : TITLES[action]}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}
        <p className="text-small text-ink-muted">{DESCRIPTIONS[action]}</p>

        {action === "quarantine" && (
          <Field label="Category" required>
            <select
              className="input"
              value={quarantineReason}
              onChange={(e) => setQuarantineReason(e.target.value)}
            >
              {QUARANTINE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {action === "release" && (
          <Field
            label="Released on the evidence of"
            required
            hint="Certificate of analysis, deviation closure, or the inspection record"
          >
            <input
              className="input"
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
              placeholder="COA-2026-00412"
            />
          </Field>
        )}

        <Field label="Reason" required hint="Recorded in the audit trail under your name">
          <textarea
            className="input min-h-[72px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
