"use client";

import { useState } from "react";
import Link from "next/link";
import { Shell, PageHeader } from "@/components/Shell";
import { Scanner, ScanResolution } from "@/components/Scanner";
import { BatchStatus, Card, Empty, Pill, Table } from "@/components/ui";
import { shortDate } from "@/lib/api";

export default function ScanPage() {
  const [history, setHistory] = useState<ScanResolution[]>([]);
  const latest = history[0];

  return (
    <Shell>
      <PageHeader
        title="Scan Station"
        subtitle="Resolves GS1 DataMatrix, EAN-13, UPC and Code 128 to product, batch, expiry and serial."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scanner">
          <Scanner
            onResolved={(r) => setHistory((h) => [r, ...h].slice(0, 25))}
          />
        </Card>

        <Card title="Result">
          {!latest && (
            <Empty>Scan a pack to see what the system reads from it.</Empty>
          )}

          {latest && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={latest.parsed.isGs1 ? "ok" : "warn"}>
                  {latest.parsed.format}
                </Pill>
                {latest.parsed.isGs1 ? (
                  <Pill tone="ok">GS1 identification</Pill>
                ) : (
                  <Pill tone="warn">Not GS1 — batch/expiry not trusted</Pill>
                )}
              </div>

              {latest.product ? (
                <div className="rounded-md bg-surface-sunken p-3">
                  <div className="font-semibold">
                    {latest.product.genericName} {latest.product.strength}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {latest.product.brandName} · {latest.product.sku} ·{" "}
                    {latest.product.dosageForm}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {latest.product.requiresPrescription && (
                      <Pill tone="warn">Prescription only</Pill>
                    )}
                    {latest.product.isControlled && (
                      <Pill tone="danger">Controlled</Pill>
                    )}
                    {latest.product.isColdChain && (
                      <Pill tone="info">Cold chain</Pill>
                    )}
                  </div>
                  <Link
                    className="mt-2 inline-block text-xs text-brand-dark underline"
                    href={`/inventory?search=${encodeURIComponent(latest.product.genericName)}`}
                  >
                    View stock for this product
                  </Link>
                </div>
              ) : (
                <div className="rounded-md border border-warn/30 bg-warn-light p-3 text-warn">
                  No product in the drug master matches this code.
                </div>
              )}

              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-ink-muted">GTIN</dt>
                  <dd className="num font-medium">
                    {latest.parsed.gtin ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Batch / lot</dt>
                  <dd className="font-medium">
                    {latest.parsed.batchNumber ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Expiry on pack</dt>
                  <dd className="font-medium">
                    {shortDate(latest.parsed.expiryDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Serial</dt>
                  <dd className="font-medium">
                    {latest.parsed.serialNumber ?? "-"}
                  </dd>
                </div>
              </dl>

              {latest.batch && (
                <div className="rounded-md bg-surface-sunken p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      Registered batch {latest.batch.batchNumber}
                    </span>
                    <BatchStatus status={latest.batch.status} />
                  </div>
                  <div className="text-ink-muted">
                    System expiry: {shortDate(latest.batch.expiryDate)}
                  </div>
                </div>
              )}

              {latest.warnings.length > 0 && (
                <ul className="space-y-1">
                  {latest.warnings.map((w, i) => (
                    <li
                      key={i}
                      className={`rounded-md px-3 py-2 text-xs ${
                        w.includes("EXPIRED") || w.includes("cannot be")
                          ? "bg-danger-light text-danger"
                          : "bg-warn-light text-warn"
                      }`}
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>

      {history.length > 1 && (
        <Card className="mt-4" title={`Session history (${history.length})`}>
          <Table head={["Format", "Product", "Batch", "Expiry", "Warnings"]}>
            {history.map((h, i) => (
              <tr key={i}>
                <td className="td text-xs">{h.parsed.format}</td>
                <td className="td">
                  {h.product
                    ? `${h.product.genericName} ${h.product.strength}`
                    : "unmatched"}
                </td>
                <td className="td text-ink-muted">
                  {h.parsed.batchNumber ?? "-"}
                </td>
                <td className="td text-ink-muted">
                  {shortDate(h.parsed.expiryDate)}
                </td>
                <td className="td text-xs text-ink-muted">
                  {h.warnings.length || "-"}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </Shell>
  );
}
