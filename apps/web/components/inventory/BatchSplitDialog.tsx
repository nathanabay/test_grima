"use client";

import { useEffect, useState } from "react";
import { Drawer, Field } from "@/components/primitives";
import { ErrorBox } from "@/components/ui";
import { api, qty, shortDate } from "@/lib/api";

/**
 * Splitting or repacking a batch (§7).
 *
 * The schema has carried `parentBatchId` from the beginning and nothing could
 * write it, so batch genealogy was a column that recorded nothing. The child
 * keeps the parent's expiry, cost and supplier — the medicine has not changed,
 * only the container it is counted in — and both movements go through the
 * ledger, so a split can never create stock.
 */
export function BatchSplitDialog({
  batch,
  open,
  onClose,
  onDone,
}: {
  batch: any | null;
  open: boolean;
  onClose: () => void;
  onDone: (child: any) => void;
}) {
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [newBatchNumber, setNewBatchNumber] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const positions = (batch?.balances ?? []).filter((b: any) => Number(b.onHand) > 0);

  useEffect(() => {
    if (!open) return;
    setQuantity("");
    setNewBatchNumber("");
    setReason("");
    setError(null);
    setWarehouseId(positions[0]?.warehouseId ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batch?.id]);

  if (!open || !batch) return null;

  const chosen = positions.find((p: any) => p.warehouseId === warehouseId);
  const availableHere = chosen ? Number(chosen.onHand) - Number(chosen.reserved) : 0;

  async function submit() {
    setError(null);
    const amount = Number(quantity);
    if (!warehouseId) return setError("Choose the warehouse the stock is being split in.");
    if (!(amount > 0)) return setError("Split a quantity greater than zero.");
    if (amount > availableHere) {
      return setError(`Only ${availableHere} is unreserved in that warehouse.`);
    }
    if (!reason.trim()) return setError("Say why the batch is being split.");

    setBusy(true);
    try {
      const child = await api<any>(`/inventory/batches/${batch.id}/split`, {
        method: "POST",
        body: {
          warehouseId,
          quantity: amount,
          newBatchNumber: newBatchNumber.trim() || undefined,
          locationId: chosen?.locationId ?? undefined,
          reason: reason.trim(),
        },
      });
      onDone(child);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Split the batch"
      description={`${batch.batchNumber} · expires ${shortDate(batch.expiryDate)}`}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Splitting…" : "Split"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}

        <p className="text-small text-ink-muted">
          The new batch keeps this one&rsquo;s expiry date, cost and supplier, and records this
          batch as its parent. Nothing is created — the quantity moves.
        </p>

        <Field label="From" required>
          <select
            className="input"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {positions.length === 0 && <option value="">No stock to split</option>}
            {positions.map((p: any) => (
              <option key={p.warehouseId} value={p.warehouseId}>
                {p.warehouse?.name ?? p.warehouseId.slice(0, 8)} — {qty(p.onHand)} on hand
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Quantity"
          required
          hint={chosen ? `${availableHere} unreserved in that warehouse` : undefined}
        >
          <input
            className="input"
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>

        <Field
          label="New batch number"
          hint={`Leave blank for ${batch.batchNumber}-n`}
        >
          <input
            className="input"
            value={newBatchNumber}
            onChange={(e) => setNewBatchNumber(e.target.value)}
          />
        </Field>

        <Field label="Reason" required>
          <textarea
            className="input min-h-[72px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Repacked into 30-tablet cartons for the branch dispensary"
          />
        </Field>
      </div>
    </Drawer>
  );
}
