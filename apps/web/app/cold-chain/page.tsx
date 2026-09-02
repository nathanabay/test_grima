'use client';

import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { qty, shortDate } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

export default function ColdChainPage() {
  const live = useApi<any[]>('/cold-chain/live');
  const excursions = useApi<any>('/cold-chain/excursions?pageSize=25');

  return (
    <Shell>
      <PageHeader
        title="Cold Chain"
        subtitle="A breach that outlasts the sensor tolerance quarantines the affected stock automatically and waits for a QA decision."
      />

      <div className="space-y-4">
        <Card title="Live sensor readings">
          {live.loading && <Loading />}
          {live.error && <ErrorBox message={live.error} />}
          {live.data?.length ? (
            <Table head={['Sensor', 'Warehouse', 'Required range', 'Current', 'Last reading', 'Status']}>
              {live.data.map((s) => (
                <tr key={s.sensorId}>
                  <td className="td font-medium">{s.name}<div className="text-xs text-ink-subtle">{s.code}</div></td>
                  <td className="td text-ink-muted">{s.warehouseName}</td>
                  <td className="td text-ink-muted">{s.requiredRange}</td>
                  <td className="td num font-medium">
                    {s.currentTemperature !== null ? `${Number(s.currentTemperature).toFixed(1)}C` : '-'}
                    {s.currentHumidity !== null && (
                      <div className="text-xs text-ink-subtle">{Number(s.currentHumidity).toFixed(0)}% RH</div>
                    )}
                  </td>
                  <td className="td text-xs text-ink-muted">
                    {s.lastReadingAt ? new Date(s.lastReadingAt).toLocaleString() : 'never'}
                  </td>
                  <td className="td">
                    <Pill
                      tone={
                        s.status === 'OK' ? 'ok' : s.status === 'EXCURSION' ? 'danger' : 'warn'
                      }
                    >
                      {s.status}
                    </Pill>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !live.loading && <Empty>No temperature sensors are configured.</Empty>
          )}
        </Card>

        <Card title="Temperature excursions">
          {excursions.loading && <Loading />}
          {excursions.data?.data?.length ? (
            <Table head={['Excursion', 'Sensor', 'Started', 'Duration', 'Range reached', 'Affected', 'Disposition']}>
              {excursions.data.data.map((e: any) => (
                <tr key={e.id}>
                  <td className="td font-medium">{e.excursionNo}</td>
                  <td className="td text-ink-muted">{e.sensor.name}</td>
                  <td className="td text-ink-muted">{shortDate(e.startedAt)}</td>
                  <td className="td num">{e.durationMinutes} min</td>
                  <td className="td num">
                    {Number(e.minTempC).toFixed(1)}C – {Number(e.maxTempC).toFixed(1)}C
                  </td>
                  <td className="td num">
                    {e.affectedBatchIds.length} batches
                    <div className="text-xs text-ink-subtle">{qty(e.affectedQuantity)} units</div>
                  </td>
                  <td className="td">
                    <Pill
                      tone={
                        e.disposition === 'PENDING'
                          ? 'warn'
                          : e.disposition === 'RELEASED'
                            ? 'ok'
                            : 'danger'
                      }
                    >
                      {e.disposition}
                    </Pill>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !excursions.loading && <Empty>No temperature excursions recorded.</Empty>
          )}
        </Card>
      </div>
    </Shell>
  );
}
