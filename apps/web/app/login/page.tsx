'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

const DEMO_ACCOUNTS = [
  ['admin', 'Super Administrator'],
  ['manager', 'Pharmacy Administrator'],
  ['pharmacist', 'Pharmacist'],
  ['procurement', 'Procurement Officer'],
  ['warehouse', 'Warehouse Manager'],
  ['cashier', 'Cashier'],
  ['qa', 'QA Officer'],
  ['auditor', 'Auditor (read-only)'],
];

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('admin');
  const [password, setPassword] = useState('PharmaCore#2026');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password, mfaCode || undefined);
      router.replace('/dashboard');
    } catch (err: any) {
      if (err.body?.error?.mfaRequired || err.body?.mfaRequired) {
        setMfaRequired(true);
        setError('Enter the code from your authenticator app.');
      } else {
        setError(err.message ?? 'Sign-in failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold text-brand-dark">PharmaCore</div>
          <p className="mt-1 text-sm text-ink-muted">
            Enterprise Pharmacy Inventory &amp; Management
          </p>
        </div>

        <form onSubmit={submit} className="card p-5 space-y-4">
          {error && <ErrorBox message={error} />}

          <div>
            <label className="label" htmlFor="identifier">
              Email, username or phone
            </label>
            <input
              id="identifier"
              className="input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {mfaRequired && (
            <div>
              <label className="label" htmlFor="mfa">
                Authentication code
              </label>
              <input
                id="mfa"
                className="input num"
                inputMode="numeric"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="000000"
              />
            </div>
          )}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="card mt-4 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Demo accounts
          </div>
          <p className="mt-1 mb-2 text-xs text-ink-subtle">
            All use the password <code className="rounded bg-surface-sunken px-1">PharmaCore#2026</code>.
            Each role sees a different subset of the system.
          </p>
          <div className="grid grid-cols-1 gap-1">
            {DEMO_ACCOUNTS.map(([name, role]) => (
              <button
                key={name}
                type="button"
                onClick={() => setIdentifier(name)}
                className="flex items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-surface-sunken"
              >
                <span className="font-medium text-ink">{name}</span>
                <span className="text-ink-subtle">{role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
