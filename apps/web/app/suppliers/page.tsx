"use client";

import { useEffect, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, can, money, qty, shortDate, tokenStore } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";
import { DocumentsTab } from "@/components/DocumentsTab";
import {
  Card as Panel,
  EmptyState,
  ErrorState,
  Field,
  Stat,
} from "@/components/primitives";
import { DataTable } from "@/components/DataTable";
import { StatusBadge, SeverityBadge } from "@/components/status";

export default function SuppliersPage() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<
    "Profile" | "Risk" | "Products" | "Orders" | "Documents"
  >("Profile");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canEdit = can(user, "procurement.supplier.CREATE");

  const list = useApi<any>(
    `/suppliers?pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    [query],
  );
  const detail = useApi<any>(selectedId ? `/suppliers/${selectedId}` : null, [
    selectedId,
  ]);

  async function create(form: FormData) {
    setError(null);
    try {
      const created = await api("/suppliers", {
        method: "POST",
        body: {
          code: String(form.get("code")),
          companyName: String(form.get("companyName")),
          contactName: String(form.get("contactName") || "") || null,
          phone: String(form.get("phone") || "") || null,
          email: String(form.get("email") || "") || null,
          city: String(form.get("city") || "") || null,
          country: "ET",
          licenseNumber: String(form.get("licenseNumber") || "") || null,
          licenseExpiry: form.get("licenseExpiry")
            ? new Date(String(form.get("licenseExpiry")))
            : null,
          paymentTerms: String(form.get("paymentTerms") || "NET30"),
          leadTimeDays: Number(form.get("leadTimeDays") || 14),
        },
      });
      setCreating(false);
      list.refresh();
      setSelectedId(created.id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Suppliers"
        subtitle="Profiles, performance scores computed from actual receipts, and regulatory documents."
        action={
          canEdit && (
            <button
              className="btn-primary"
              onClick={() => setCreating((v) => !v)}
            >
              {creating ? "Cancel" : "Add supplier"}
            </button>
          )
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      {creating && (
        <Card className="mb-4" title="New supplier">
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create(new FormData(e.currentTarget));
            }}
          >
            <div>
              <label className="label">Code</label>
              <input name="code" className="input" required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Company name</label>
              <input name="companyName" className="input" required />
            </div>
            <div>
              <label className="label">Contact</label>
              <input name="contactName" className="input" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" className="input" />
            </div>
            <div>
              <label className="label">City</label>
              <input name="city" className="input" />
            </div>
            <div>
              <label className="label">Import licence no.</label>
              <input name="licenseNumber" className="input" />
            </div>
            <div>
              <label className="label">Licence expiry</label>
              <input name="licenseExpiry" type="date" className="input" />
            </div>
            <div>
              <label className="label">Payment terms</label>
              <select
                aria-label="Payment terms"
                name="paymentTerms"
                className="input"
              >
                {["NET15", "NET30", "NET45", "NET60"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Lead time (days)</label>
              <input
                name="leadTimeDays"
                type="number"
                min={1}
                defaultValue={14}
                className="input"
              />
            </div>
            <div className="sm:col-span-3">
              <button className="btn-primary">Create supplier</button>
            </div>
          </form>
        </Card>
      )}

      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(term);
          }}
        >
          <input
            className="input flex-1"
            placeholder="Search by company, code or contact"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button className="btn-primary">Search</button>
        </form>
      </Card>

      {list.loading && <Loading />}
      {list.error && <ErrorBox message={list.error} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          title={`${list.data?.total ?? 0} suppliers`}
        >
          {list.data?.data?.length ? (
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {list.data.data.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${
                    selectedId === s.id
                      ? "border-brand bg-brand-light"
                      : "border-transparent hover:bg-surface-sunken"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.companyName}</span>
                    <Pill
                      tone={
                        Number(s.supplierScore) >= 75
                          ? "ok"
                          : Number(s.supplierScore) >= 55
                            ? "warn"
                            : "danger"
                      }
                    >
                      {Number(s.supplierScore).toFixed(0)}
                    </Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {s.code} · {s.city ?? "-"} · lead {s.leadTimeDays}d
                    {!s.isApproved && " · not approved"}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No suppliers match.</Empty>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && (
            <Card>
              <Empty>Select a supplier.</Empty>
            </Card>
          )}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card title={detail.data.companyName}>
              <div className="mb-3 flex gap-1 border-b border-surface-border pb-2">
                {(
                  [
                    "Profile",
                    "Risk",
                    "Products",
                    "Orders",
                    "Documents",
                  ] as const
                ).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-md px-2 py-1 text-xs ${
                      tab === t
                        ? "bg-brand-light font-medium text-brand-dark"
                        : "text-ink-muted hover:bg-surface-sunken"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === "Profile" && (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ["Code", detail.data.code],
                    ["Contact", detail.data.contactName],
                    ["Phone", detail.data.phone],
                    ["Email", detail.data.email],
                    ["City", detail.data.city],
                    ["Tax ID", detail.data.taxId],
                    ["Import licence", detail.data.licenseNumber],
                    ["Licence expiry", shortDate(detail.data.licenseExpiry)],
                    ["Payment terms", detail.data.paymentTerms],
                    ["Lead time", `${detail.data.leadTimeDays} days`],
                    ["Minimum order", money(detail.data.minimumOrderValue)],
                    ["Approved", detail.data.isApproved ? "yes" : "no"],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-xs text-ink-muted">{k}</dt>
                      <dd className="text-sm font-medium">{v || "-"}</dd>
                    </div>
                  ))}
                  <div className="col-span-2 sm:col-span-3 mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["Score", Number(detail.data.supplierScore).toFixed(1)],
                      [
                        "On-time delivery",
                        `${(Number(detail.data.onTimeDeliveryRate) * 100).toFixed(0)}%`,
                      ],
                      [
                        "Rejection rate",
                        `${(Number(detail.data.rejectionRate) * 100).toFixed(1)}%`,
                      ],
                      ["Quality incidents", detail.data.qualityIncidents],
                    ].map(([k, v]) => (
                      <div
                        key={String(k)}
                        className="rounded-md bg-surface-sunken p-2"
                      >
                        <div className="text-xs text-ink-muted">{k}</div>
                        <div className="text-lg font-semibold num">{v}</div>
                      </div>
                    ))}
                  </div>
                </dl>
              )}

              {tab === "Risk" && (
                <SupplierRisk
                  supplier={detail.data}
                  canEdit={canEdit}
                  onSaved={() => {
                    detail.refresh();
                    list.refresh();
                  }}
                />
              )}

              {tab === "Products" && (
                <Table
                  head={["SKU", "Product", "Unit price", "MOQ", "Preferred"]}
                >
                  {detail.data.products.map((sp: any) => (
                    <tr key={sp.id}>
                      <td className="td text-ink-muted">{sp.product.sku}</td>
                      <td className="td">{sp.product.genericName}</td>
                      <td className="td num">{money(sp.unitPrice)}</td>
                      <td className="td num">{Number(sp.moq)}</td>
                      <td className="td">
                        {sp.isPreferred ? <Pill tone="ok">preferred</Pill> : ""}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}

              {tab === "Orders" && (
                <Table head={["PO", "Status", "Ordered", "Total"]}>
                  {detail.data.purchaseOrders.length ? (
                    detail.data.purchaseOrders.map((po: any) => (
                      <tr key={po.id}>
                        <td className="td font-medium">{po.poNo}</td>
                        <td className="td text-xs">
                          {po.status.replace(/_/g, " ")}
                        </td>
                        <td className="td text-ink-muted">
                          {shortDate(po.orderDate)}
                        </td>
                        <td className="td num">{money(po.grandTotal)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="td text-ink-subtle" colSpan={4}>
                        No purchase orders yet.
                      </td>
                    </tr>
                  )}
                </Table>
              )}

              {tab === "Documents" && (
                <DocumentsTab entityType="SUPPLIER" entityId={detail.data.id} />
              )}
            </Card>
          )}
        </div>
      </div>

      <DependencyAnalysis />
    </Shell>
  );
}

/**
 * Risk rating, credit exposure and the reason both matter (§13).
 *
 * The score above is measured from receipts; the risk level here is a judgement
 * a buyer makes and has to justify in writing. Keeping them apart stops a good
 * delivery record from masking a supplier who is one shipment from insolvency.
 */
function SupplierRisk({
  supplier,
  canEdit,
  onSaved,
}: {
  supplier: any;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [riskLevel, setRiskLevel] = useState(supplier.riskLevel ?? "LOW");
  const [riskNotes, setRiskNotes] = useState(supplier.riskNotes ?? "");
  const [creditLimit, setCreditLimit] = useState(
    String(supplier.creditLimit ?? 0),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const credit = useApi<any>(`/suppliers/${supplier.id}/credit`, [
    supplier.id,
    saved,
  ]);

  useEffect(() => {
    setRiskLevel(supplier.riskLevel ?? "LOW");
    setRiskNotes(supplier.riskNotes ?? "");
    setCreditLimit(String(supplier.creditLimit ?? 0));
  }, [
    supplier.id,
    supplier.riskLevel,
    supplier.riskNotes,
    supplier.creditLimit,
  ]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/suppliers/${supplier.id}`, {
        method: "PATCH",
        body: {
          riskLevel,
          riskNotes: riskNotes || null,
          creditLimit: Number(creditLimit),
        },
      });
      setSaved((v) => !v);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const exposure = credit.data;

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Risk rating"
          value={riskLevel}
          tone={
            riskLevel === "CRITICAL"
              ? "danger"
              : riskLevel === "HIGH"
                ? "warn"
                : "ok"
          }
          sub="Set by procurement"
        />
        <Stat
          label="Credit limit"
          value={exposure ? money(exposure.creditLimit) : "-"}
          sub={
            exposure?.hasLimit ? "Agreed with the supplier" : "No limit agreed"
          }
        />
        <Stat
          label="Outstanding"
          value={exposure ? money(exposure.outstanding) : "-"}
          tone={exposure?.overLimit ? "danger" : "neutral"}
          sub={
            exposure?.utilisationPercent
              ? `${exposure.utilisationPercent}% of the limit`
              : "Unpaid invoices"
          }
        />
        <Stat
          label="Overdue"
          value={exposure ? money(exposure.overdue) : "-"}
          tone={exposure && Number(exposure.overdue) > 0 ? "warn" : "ok"}
          sub="Past the due date"
        />
      </div>

      {exposure?.overLimit && (
        <div className="rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-small text-danger">
          This supplier is over their agreed credit limit. Approving a further
          purchase order will be refused until outstanding invoices are settled
          or the limit is raised.
        </div>
      )}

      {canEdit ? (
        <Panel title="Risk assessment">
          <div className="space-y-3">
            <Field
              label="Risk level"
              hint="How exposed the pharmacy is if this supplier stops delivering."
            >
              <select
                className="input"
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value)}
              >
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Why"
              hint="A rating with no reasoning cannot be reviewed by anyone else."
            >
              <textarea
                className="input min-h-[6rem]"
                value={riskNotes}
                onChange={(e) => setRiskNotes(e.target.value)}
              />
            </Field>
            <Field
              label="Credit limit"
              hint="Zero means no limit was agreed; purchase orders are then not checked against one."
            >
              <input
                className="input num"
                type="number"
                min={0}
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
              />
            </Field>
            <button
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={save}
            >
              {busy ? "Saving..." : "Save assessment"}
            </button>
          </div>
        </Panel>
      ) : (
        <Panel title="Risk assessment">
          <p className="text-small text-ink-muted">
            {riskNotes || "No assessment has been recorded."}
          </p>
        </Panel>
      )}
    </div>
  );
}

/**
 * Which medicines stop if one supplier stops (§13: feature 277).
 *
 * A product bought from exactly one approved supplier is a single point of
 * failure. When that supplier is also rated HIGH or CRITICAL, it is the one to
 * act on first, which is why the list is ordered by that rather than by name.
 */
function DependencyAnalysis() {
  const { data, error, loading, refresh } = useApi<any>(
    "/suppliers/dependency-analysis",
    [],
  );

  const rows: any[] = data?.rows ?? [];

  return (
    <div className="mt-4">
      {error && <ErrorState message={error} onRetry={refresh} />}
      {loading && !data && <Loading />}

      {data && (
        <Panel
          title="Single-source dependency"
          description="Products with exactly one active approved supplier. Stock cover is shown because a single-sourced product with three months on the shelf is a different problem from one with three days."
          padded={false}
        >
          <div className="p-4">
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Products with a supplier"
                value={data.productsWithASupplier}
                sub="Linked in the catalogue"
              />
              <Stat
                label="Single-sourced"
                value={data.singleSourcedCount}
                tone={data.singleSourcedCount > 0 ? "warn" : "ok"}
                sub="One supplier only"
              />
              <Stat
                label="On a risky supplier"
                value={data.atRiskCount}
                tone={data.atRiskCount > 0 ? "danger" : "ok"}
                sub="Rated HIGH or CRITICAL"
              />
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title="No single-source dependency"
                body="Every product linked to a supplier has at least two active approved sources."
              />
            ) : (
              <DataTable
                rows={rows}
                getKey={(r: any) => `${r.productId}:${r.supplierId}`}
                pageSize={15}
                exportName="single-source-dependency"
                searchPlaceholder="Search product or supplier"
                viewKey="supplier-dependency"
                rowTone={(r: any) =>
                  r.severity === "CRITICAL"
                    ? "danger"
                    : r.severity === "HIGH"
                      ? "warn"
                      : null
                }
                columns={[
                  {
                    key: "severity",
                    label: "Severity",
                    width: "7rem",
                    value: (r: any) => r.severity,
                    render: (r: any) => <SeverityBadge level={r.severity} />,
                  },
                  { key: "sku", label: "SKU", value: (r: any) => r.sku },
                  {
                    key: "product",
                    label: "Product",
                    sticky: true,
                    value: (r: any) => r.product,
                  },
                  {
                    key: "supplierName",
                    label: "Only supplier",
                    value: (r: any) => r.supplierName,
                  },
                  {
                    key: "supplierRiskLevel",
                    label: "Supplier risk",
                    width: "8rem",
                    value: (r: any) => r.supplierRiskLevel,
                    render: (r: any) => (
                      <StatusBadge status={r.supplierRiskLevel} />
                    ),
                  },
                  {
                    key: "onHand",
                    label: "On hand",
                    numeric: true,
                    value: (r: any) => Number(r.onHand),
                    render: (r: any) => qty(r.onHand),
                  },
                  {
                    key: "flags",
                    label: "Flags",
                    optional: true,
                    value: (r: any) =>
                      [
                        r.isControlled && "controlled",
                        r.isColdChain && "cold chain",
                      ]
                        .filter(Boolean)
                        .join(" "),
                    render: (r: any) => (
                      <div className="flex gap-1">
                        {r.isControlled && <StatusBadge status="CONTROLLED" />}
                        {r.isColdChain && <StatusBadge status="COLD_CHAIN" />}
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
