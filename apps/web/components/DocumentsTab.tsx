'use client';

import { useState } from 'react';
import { useApi } from '@/lib/useApi';
import { can, shortDate, tokenStore } from '@/lib/api';
import { Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Attach and browse documents for any record (§44): supplier licences, product
 * leaflets, scanned prescriptions, disposal certificates.
 */
export function DocumentsTab({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { data, loading, refresh } = useApi<any[]>(
    `/documents?entityType=${entityType}&entityId=${entityId}`,
    [entityId],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const user = typeof window !== 'undefined' ? tokenStore.user : null;
  const canUpload = can(user, 'catalog.product.EDIT');

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('entityType', entityType);
      form.append('entityId', entityId);
      if (expiresAt) form.append('expiresAt', expiresAt);

      // Multipart must not carry a JSON content-type, so this bypasses api().
      const res = await fetch(`${API_BASE}/api/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenStore.access}` },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Upload failed');
      setExpiresAt('');
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="rounded-md border border-dashed border-surface-border p-3">
          <label className="label">Attach a document</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              className="text-sm"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
            <input
              type="date"
              className="input w-auto"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              title="Expiry date, for licences and certificates"
            />
          </div>
          <p className="mt-1 text-xs text-ink-subtle">
            PDF, image, Word, Excel or CSV, up to 15 MB. Set an expiry date on licences so the
            system warns you before they lapse.
          </p>
        </div>
      )}

      {error && <ErrorBox message={error} />}
      {loading && <Loading />}

      {data?.length ? (
        <Table head={['File', 'Type', 'Size', 'Expiry', '']}>
          {data.map((d) => (
            <tr key={d.id}>
              <td className="td font-medium">{d.fileName}</td>
              <td className="td text-xs text-ink-muted">{d.mimeType}</td>
              <td className="td num">{(d.sizeBytes / 1024).toFixed(0)} KB</td>
              <td className="td">
                {d.expiresAt ? (
                  <Pill
                    tone={
                      d.expiryStatus === 'EXPIRED'
                        ? 'danger'
                        : d.expiryStatus === 'EXPIRING_SOON'
                          ? 'warn'
                          : 'ok'
                    }
                  >
                    {shortDate(d.expiresAt)}
                  </Pill>
                ) : (
                  <span className="text-ink-subtle">-</span>
                )}
              </td>
              <td className="td">
                <a
                  className="text-xs text-brand-dark underline"
                  href={`${API_BASE}${d.downloadUrl}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </a>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        !loading && <Empty>No documents attached.</Empty>
      )}
    </div>
  );
}
