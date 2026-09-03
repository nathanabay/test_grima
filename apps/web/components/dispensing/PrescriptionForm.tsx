'use client';

import { useEffect, useState } from 'react';
import { Drawer, Field } from '@/components/primitives';
import { ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Entering a prescription (§23).
 *
 * The screen used to have no way to record a prescription at all — they arrived
 * by seed or by API, which meant a pharmacy could review and dispense but never
 * take one in.
 *
 * Two decisions worth naming. Directions are captured as dose, frequency and
 * duration rather than one free-text box, because the label and the maximum
 * daily dose check both need them apart. And "do not substitute" is a per-line
 * switch, since a prescriber writes it about one medicine, not about a whole
 * prescription.
 */

interface Line {
  productId: string;
  productLabel: string;
  prescribedQty: string;
  dosage: string;
  frequency: string;
  durationDays: string;
  instructions: string;
  allowSubstitution: boolean;
}

const EMPTY_LINE: Line = {
  productId: '',
  productLabel: '',
  prescribedQty: '',
  dosage: '',
  frequency: '',
  durationDays: '',
  instructions: '',
  allowSubstitution: true,
};

export function PrescriptionForm({
  open,
  onClose,
  onCreated,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (prescription: any) => void;
  branchId: string | null;
}) {
  const [patientTerm, setPatientTerm] = useState('');
  const [patients, setPatients] = useState<any[]>([]);
  const [patient, setPatient] = useState<any | null>(null);
  const [prescriberName, setPrescriberName] = useState('');
  const [prescriberLicense, setPrescriberLicense] = useState('');
  const [facilityName, setFacilityName] = useState('');
  const [prescriptionDate, setPrescriptionDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [validUntil, setValidUntil] = useState('');
  const [refillsAllowed, setRefillsAllowed] = useState('0');
  const [isUrgent, setIsUrgent] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  const [productTerm, setProductTerm] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [activeLine, setActiveLine] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open || patientTerm.trim().length < 2) {
      setPatients([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const result = await api<any>(
          `/patients?q=${encodeURIComponent(patientTerm.trim())}&pageSize=8`,
        );
        setPatients(result.data ?? []);
      } catch {
        setPatients([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [patientTerm, open]);

  useEffect(() => {
    if (!open || productTerm.trim().length < 2) {
      setProducts([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const result = await api<any>(
          `/products?q=${encodeURIComponent(productTerm.trim())}&pageSize=8`,
        );
        setProducts(result.data ?? []);
      } catch {
        setProducts([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [productTerm, open]);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setError(null);
    if (!patient) return setError('Choose the patient this prescription is for.');
    if (!branchId) return setError('No branch is selected.');
    if (!prescriberName.trim()) return setError('Record who prescribed it.');

    const usable = lines.filter((l) => l.productId && Number(l.prescribedQty) > 0);
    if (!usable.length) {
      return setError('Add at least one medicine with a quantity greater than zero.');
    }

    setBusy(true);
    try {
      const created = await api<any>('/prescriptions', {
        method: 'POST',
        body: {
          patientId: patient.id,
          branchId,
          prescriberName: prescriberName.trim(),
          prescriberLicense: prescriberLicense.trim() || undefined,
          facilityName: facilityName.trim() || undefined,
          prescriptionDate,
          validUntil: validUntil || undefined,
          refillsAllowed: Number(refillsAllowed) || 0,
          isUrgent,
          notes: notes.trim() || undefined,
          items: usable.map((l) => ({
            productId: l.productId,
            prescribedQty: Number(l.prescribedQty),
            dosage: l.dosage.trim() || undefined,
            frequency: l.frequency.trim() || undefined,
            durationDays: l.durationDays ? Number(l.durationDays) : undefined,
            instructions: l.instructions.trim() || undefined,
            allowSubstitution: l.allowSubstitution,
          })),
        },
      });
      onCreated(created);
      // Reset only after a confirmed create: a failed submit that wiped the
      // form would make the pharmacist key it all again.
      setPatient(null);
      setPatientTerm('');
      setPrescriberName('');
      setPrescriberLicense('');
      setFacilityName('');
      setValidUntil('');
      setRefillsAllowed('0');
      setIsUrgent(false);
      setNotes('');
      setLines([{ ...EMPTY_LINE }]);
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
      title="New prescription"
      description="What the prescriber wrote. A pharmacist still has to validate it before anything is supplied."
      width="xl"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save prescription'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}

        <section className="space-y-2">
          <Field label="Patient" required hint={patient ? undefined : 'Type at least two characters'}>
            {patient ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-3 py-2">
                <span>
                  <span className="font-medium">{patient.fullName}</span>{' '}
                  <span className="text-caption text-ink-muted">{patient.patientCode}</span>
                </span>
                <button className="btn-quiet btn-sm" onClick={() => setPatient(null)}>
                  Change
                </button>
              </div>
            ) : (
              <input
                className="input"
                value={patientTerm}
                onChange={(e) => setPatientTerm(e.target.value)}
                placeholder="Name or patient code"
              />
            )}
          </Field>
          {!patient && patients.length > 0 && (
            <ul className="rounded-md border border-border">
              {patients.map((p) => (
                <li key={p.id}>
                  <button
                    className="w-full px-3 py-1.5 text-left text-small hover:bg-surface-sunken"
                    onClick={() => {
                      setPatient(p);
                      setPatients([]);
                    }}
                  >
                    {p.fullName}{' '}
                    <span className="text-caption text-ink-muted">{p.patientCode}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Prescriber" required>
            <input
              className="input"
              value={prescriberName}
              onChange={(e) => setPrescriberName(e.target.value)}
            />
          </Field>
          <Field label="Prescriber licence">
            <input
              className="input"
              value={prescriberLicense}
              onChange={(e) => setPrescriberLicense(e.target.value)}
            />
          </Field>
          <Field label="Facility">
            <input
              className="input"
              value={facilityName}
              onChange={(e) => setFacilityName(e.target.value)}
            />
          </Field>
          <Field label="Date written" required>
            <input
              className="input"
              type="date"
              value={prescriptionDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setPrescriptionDate(e.target.value)}
            />
          </Field>
          <Field
            label="Valid until"
            hint="Leave blank to use the pharmacy's configured validity period"
          >
            <input
              className="input"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </Field>
          <Field label="Repeats allowed" hint="Each repeat is issued as its own prescription">
            <input
              className="input"
              type="number"
              min={0}
              max={12}
              value={refillsAllowed}
              onChange={(e) => setRefillsAllowed(e.target.value)}
            />
          </Field>
        </section>

        <label className="flex items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={isUrgent}
            onChange={(e) => setIsUrgent(e.target.checked)}
          />
          Urgent — move to the front of the dispensing queue
        </label>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-small font-semibold">Medicines</h3>
            <button
              className="btn-ghost btn-sm"
              onClick={() => setLines((c) => [...c, { ...EMPTY_LINE }])}
            >
              Add line
            </button>
          </div>

          {lines.map((line, index) => (
            <div key={index} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {line.productId ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{line.productLabel}</span>
                      <button
                        className="btn-quiet btn-sm"
                        onClick={() => updateLine(index, { productId: '', productLabel: '' })}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <input
                      className="input"
                      value={activeLine === index ? productTerm : ''}
                      onFocus={() => {
                        setActiveLine(index);
                        setProductTerm('');
                      }}
                      onChange={(e) => setProductTerm(e.target.value)}
                      placeholder="Search a medicine"
                      aria-label={`Medicine for line ${index + 1}`}
                    />
                  )}
                </div>
                {lines.length > 1 && (
                  <button
                    className="btn-quiet btn-sm"
                    onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    Remove
                  </button>
                )}
              </div>

              {activeLine === index && !line.productId && products.length > 0 && (
                <ul className="mt-1 rounded-md border border-border">
                  {products.map((p) => (
                    <li key={p.id}>
                      <button
                        className="w-full px-3 py-1.5 text-left text-small hover:bg-surface-sunken"
                        onClick={() => {
                          updateLine(index, {
                            productId: p.id,
                            productLabel: `${p.genericName}${p.strength ? ` ${p.strength}` : ''}`,
                          });
                          setProducts([]);
                          setProductTerm('');
                        }}
                      >
                        {p.genericName} {p.strength}
                        <span className="ml-2 text-caption text-ink-muted">{p.dosageForm}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <Field label="Quantity" required>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="any"
                    value={line.prescribedQty}
                    onChange={(e) => updateLine(index, { prescribedQty: e.target.value })}
                  />
                </Field>
                <Field label="Dose">
                  <input
                    className="input"
                    value={line.dosage}
                    onChange={(e) => updateLine(index, { dosage: e.target.value })}
                    placeholder="1 tablet"
                  />
                </Field>
                <Field label="Frequency">
                  <input
                    className="input"
                    value={line.frequency}
                    onChange={(e) => updateLine(index, { frequency: e.target.value })}
                    placeholder="three times a day"
                  />
                </Field>
                <Field label="Days">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={line.durationDays}
                    onChange={(e) => updateLine(index, { durationDays: e.target.value })}
                  />
                </Field>
              </div>

              <div className="mt-2">
                <Field label="Instructions for the label">
                  <input
                    className="input"
                    value={line.instructions}
                    onChange={(e) => updateLine(index, { instructions: e.target.value })}
                    placeholder="Take with food"
                  />
                </Field>
              </div>

              <label className="mt-2 flex items-center gap-2 text-small">
                <input
                  type="checkbox"
                  checked={!line.allowSubstitution}
                  onChange={(e) => updateLine(index, { allowSubstitution: !e.target.checked })}
                />
                Do not substitute — this brand only
              </label>
            </div>
          ))}
        </section>

        <Field label="Notes">
          <textarea
            className="input min-h-[64px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
