import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopeService } from '../../common/guards/scope.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  /** Where clicking the result goes. */
  linkUrl: string;
  /** What matched, so the user can see why this came back. */
  matchedOn: string;
  /** Higher sorts first. */
  score: number;
  badge?: string;
}

/**
 * Global search (§62).
 *
 * Two rules govern everything here:
 *
 *  1. Authorization is applied per entity, not to the result list afterwards.
 *     A user without the patient permission never has patients queried, so a
 *     result count cannot leak the existence of records they may not see.
 *  2. Branch scope is applied inside each query. A branch user searching a
 *     batch number must not discover that another branch holds it.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  private can(user: AuthenticatedUser, permission: string): boolean {
    return user.permissions.includes(permission);
  }

  async search(
    user: AuthenticatedUser,
    query: string,
    options: { types?: string[]; limit?: number } = {},
  ) {
    const term = (query ?? '').trim();
    if (term.length < 2) {
      return {
        query: term,
        hits: [],
        total: 0,
        searched: [],
        skipped: [],
        note: 'Enter at least two characters',
      };
    }

    const limit = Math.min(options.limit ?? 8, 25);
    const wanted = options.types?.length ? new Set(options.types) : null;
    const want = (type: string) => !wanted || wanted.has(type);

    const branchFilter = this.scope.branchFilter(user) as { branchId?: { in: string[] } };
    const searched: string[] = [];
    const skipped: { type: string; reason: string }[] = [];

    const tasks: Promise<SearchHit[]>[] = [];

    const run = (
      type: string,
      permission: string,
      fn: () => Promise<SearchHit[]>,
    ) => {
      if (!want(type)) return;
      if (!this.can(user, permission)) {
        skipped.push({ type, reason: `requires ${permission}` });
        return;
      }
      searched.push(type);
      tasks.push(fn().catch(() => []));
    };

    run('product', 'catalog.product.READ', () => this.products(term, limit));
    run('batch', 'inventory.batch.READ', () => this.batches(term, limit, branchFilter));
    run('serial', 'inventory.batch.READ', () => this.serials(term, limit));
    run('supplier', 'procurement.supplier.READ', () => this.suppliers(term, limit));
    run('purchase_order', 'procurement.purchase_order.READ', () => this.purchaseOrders(term, limit, branchFilter));
    run('goods_receipt', 'inventory.goods_receipt.READ', () => this.goodsReceipts(term, limit));
    run('transfer', 'inventory.transfer.READ', () => this.transfers(term, limit));
    run('prescription', 'dispensing.prescription.READ', () => this.prescriptions(term, limit, branchFilter));
    run('patient', 'sales.patient.READ', () => this.patients(term, limit));
    run('sale', 'sales.sale.READ', () => this.sales(term, limit, branchFilter));
    run('invoice', 'finance.invoice.READ', () => this.invoices(term, limit));
    run('return', 'quality.return.READ', () => this.returns(term, limit));
    run('recall', 'quality.recall.READ', () => this.recalls(term, limit));
    run('incident', 'quality.incident.READ', () => this.incidents(term, limit));
    run('user', 'admin.user.READ', () => this.users(term, limit));

    const results = (await Promise.all(tasks)).flat();
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    return {
      query: term,
      total: results.length,
      hits: results,
      // Stated so a user who expected a result knows why they did not get one.
      searched,
      skipped,
    };
  }

  /** An exact match on a code beats a partial match on a name. */
  private score(term: string, ...fields: (string | null | undefined)[]): number {
    const lower = term.toLowerCase();
    let best = 10;
    for (const field of fields) {
      if (!field) continue;
      const value = field.toLowerCase();
      if (value === lower) return 100;
      if (value.startsWith(lower)) best = Math.max(best, 70);
      else if (value.includes(lower)) best = Math.max(best, 40);
    }
    return best;
  }

  private async products(term: string, take: number): Promise<SearchHit[]> {
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { sku: { contains: term, mode: 'insensitive' } },
          { gtin: { contains: term } },
          { genericName: { contains: term, mode: 'insensitive' } },
          { brandName: { contains: term, mode: 'insensitive' } },
          { activeIngredient: { contains: term, mode: 'insensitive' } },
          { atcCode: { contains: term, mode: 'insensitive' } },
          { barcodes: { some: { barcode: { contains: term } } } },
          { ingredients: { some: { name: { contains: term, mode: 'insensitive' } } } },
        ],
      },
      select: {
        id: true,
        sku: true,
        gtin: true,
        genericName: true,
        brandName: true,
        strength: true,
        dosageForm: true,
        isActive: true,
        isControlled: true,
      },
      take,
    });

    return products.map((p) => ({
      type: 'product',
      id: p.id,
      title: `${p.brandName ? `${p.brandName} — ` : ''}${p.genericName} ${p.strength}`,
      subtitle: `${p.dosageForm} · SKU ${p.sku}${p.gtin ? ` · GTIN ${p.gtin}` : ''}`,
      linkUrl: `/products?id=${p.id}`,
      matchedOn: 'product, brand, ingredient, SKU, GTIN or barcode',
      score: this.score(term, p.sku, p.gtin, p.genericName, p.brandName),
      badge: !p.isActive ? 'INACTIVE' : p.isControlled ? 'CONTROLLED' : undefined,
    }));
  }

  private async batches(
    term: string,
    take: number,
    branchFilter: { branchId?: { in: string[] } },
  ): Promise<SearchHit[]> {
    const batches = await this.prisma.batch.findMany({
      where: {
        OR: [
          { batchNumber: { contains: term, mode: 'insensitive' } },
          { lotNumber: { contains: term, mode: 'insensitive' } },
        ],
        // Scope through the balances: a branch user only finds a batch their
        // own branch actually holds.
        ...(branchFilter.branchId ? { balances: { some: branchFilter } } : {}),
      },
      select: {
        id: true,
        batchNumber: true,
        expiryDate: true,
        status: true,
        product: { select: { genericName: true, strength: true } },
      },
      take,
    });

    return batches.map((b) => ({
      type: 'batch',
      id: b.id,
      title: `Batch ${b.batchNumber}`,
      subtitle: `${b.product.genericName} ${b.product.strength} · expires ${b.expiryDate.toISOString().slice(0, 10)}`,
      linkUrl: `/batches?id=${b.id}`,
      matchedOn: 'batch or lot number',
      score: this.score(term, b.batchNumber),
      badge: b.status,
    }));
  }

  private async serials(term: string, take: number): Promise<SearchHit[]> {
    const serials = await this.prisma.serialNumber.findMany({
      where: { serial: { contains: term, mode: 'insensitive' } },
      select: { id: true, serial: true, status: true, batchId: true },
      take,
    });

    return serials.map((s) => ({
      type: 'serial',
      id: s.id,
      title: `Serial ${s.serial}`,
      subtitle: `Status ${s.status}`,
      linkUrl: `/batches?batchId=${s.batchId}`,
      matchedOn: 'serial number',
      score: this.score(term, s.serial),
      badge: s.status,
    }));
  }

  private async suppliers(term: string, take: number): Promise<SearchHit[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        OR: [
          { code: { contains: term, mode: 'insensitive' } },
          { companyName: { contains: term, mode: 'insensitive' } },
          { contactName: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term } },
        ],
      },
      select: { id: true, code: true, companyName: true, city: true, isActive: true, isApproved: true },
      take,
    });

    return suppliers.map((s) => ({
      type: 'supplier',
      id: s.id,
      title: s.companyName,
      subtitle: `${s.code}${s.city ? ` · ${s.city}` : ''}`,
      linkUrl: `/suppliers?id=${s.id}`,
      matchedOn: 'supplier name, code or contact',
      score: this.score(term, s.code, s.companyName),
      badge: !s.isActive ? 'INACTIVE' : !s.isApproved ? 'UNAPPROVED' : undefined,
    }));
  }

  private async purchaseOrders(
    term: string,
    take: number,
    branchFilter: object,
  ): Promise<SearchHit[]> {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { poNo: { contains: term, mode: 'insensitive' }, ...branchFilter },
      select: {
        id: true,
        poNo: true,
        status: true,
        grandTotal: true,
        supplier: { select: { companyName: true } },
      },
      take,
    });

    return orders.map((o) => ({
      type: 'purchase_order',
      id: o.id,
      title: o.poNo,
      subtitle: `${o.supplier.companyName} · ${o.grandTotal.toString()}`,
      linkUrl: `/procurement?poId=${o.id}`,
      matchedOn: 'purchase order number',
      score: this.score(term, o.poNo),
      badge: o.status,
    }));
  }

  private async goodsReceipts(term: string, take: number): Promise<SearchHit[]> {
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: { grnNo: { contains: term, mode: 'insensitive' } },
      select: { id: true, grnNo: true, receivedAt: true, status: true },
      take,
    });

    return receipts.map((r) => ({
      type: 'goods_receipt',
      id: r.id,
      title: r.grnNo,
      subtitle: `Received ${r.receivedAt.toISOString().slice(0, 10)}`,
      linkUrl: `/receiving?id=${r.id}`,
      matchedOn: 'goods receipt number',
      score: this.score(term, r.grnNo),
      badge: r.status,
    }));
  }

  private async transfers(term: string, take: number): Promise<SearchHit[]> {
    const transfers = await this.prisma.stockTransfer.findMany({
      where: { transferNo: { contains: term, mode: 'insensitive' } },
      select: { id: true, transferNo: true, status: true, createdAt: true },
      take,
    });

    return transfers.map((t) => ({
      type: 'transfer',
      id: t.id,
      title: t.transferNo,
      subtitle: `Raised ${t.createdAt.toISOString().slice(0, 10)}`,
      linkUrl: `/transfers?id=${t.id}`,
      matchedOn: 'transfer number',
      score: this.score(term, t.transferNo),
      badge: t.status,
    }));
  }

  private async prescriptions(
    term: string,
    take: number,
    branchFilter: object,
  ): Promise<SearchHit[]> {
    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        OR: [
          { prescriptionNo: { contains: term, mode: 'insensitive' } },
          { prescriberName: { contains: term, mode: 'insensitive' } },
        ],
        ...branchFilter,
      },
      select: {
        id: true,
        prescriptionNo: true,
        status: true,
        prescriberName: true,
        patient: { select: { fullName: true } },
      },
      take,
    });

    return prescriptions.map((p) => ({
      type: 'prescription',
      id: p.id,
      title: p.prescriptionNo,
      subtitle: `${p.patient.fullName} · ${p.prescriberName}`,
      linkUrl: `/dispensing?prescriptionId=${p.id}`,
      matchedOn: 'prescription number or prescriber',
      score: this.score(term, p.prescriptionNo, p.prescriberName),
      badge: p.status,
    }));
  }

  private async patients(term: string, take: number): Promise<SearchHit[]> {
    const patients = await this.prisma.patient.findMany({
      where: {
        // An anonymised record is excluded: the whole point of anonymising was
        // that the person can no longer be found by name (§14).
        isAnonymized: false,
        OR: [
          { patientCode: { contains: term, mode: 'insensitive' } },
          { fullName: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term } },
        ],
      },
      select: { id: true, patientCode: true, fullName: true, phone: true, patientType: true },
      take,
    });

    return patients.map((p) => ({
      type: 'patient',
      id: p.id,
      title: p.fullName,
      subtitle: `${p.patientCode}${p.phone ? ` · ${p.phone}` : ''}`,
      linkUrl: `/patients?id=${p.id}`,
      matchedOn: 'patient name, code or phone',
      score: this.score(term, p.patientCode, p.fullName, p.phone),
      badge: p.patientType === 'INDIVIDUAL' ? undefined : p.patientType,
    }));
  }

  private async sales(term: string, take: number, branchFilter: object): Promise<SearchHit[]> {
    const sales = await this.prisma.sale.findMany({
      where: { saleNo: { contains: term, mode: 'insensitive' }, ...branchFilter },
      select: { id: true, saleNo: true, grandTotal: true, status: true, soldAt: true },
      take,
    });

    return sales.map((s) => ({
      type: 'sale',
      id: s.id,
      title: s.saleNo,
      subtitle: `${s.grandTotal.toString()}${s.soldAt ? ` · ${s.soldAt.toISOString().slice(0, 10)}` : ''}`,
      linkUrl: `/pos?saleId=${s.id}`,
      matchedOn: 'sale number',
      score: this.score(term, s.saleNo),
      badge: s.status,
    }));
  }

  private async invoices(term: string, take: number): Promise<SearchHit[]> {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        OR: [
          { internalNo: { contains: term, mode: 'insensitive' } },
          { supplierInvoiceNo: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        internalNo: true,
        supplierInvoiceNo: true,
        grandTotal: true,
        status: true,
        supplier: { select: { companyName: true } },
      },
      take,
    });

    return invoices.map((i) => ({
      type: 'invoice',
      id: i.id,
      title: `${i.internalNo} (${i.supplierInvoiceNo})`,
      subtitle: `${i.supplier.companyName} · ${i.grandTotal.toString()}`,
      linkUrl: `/invoices?id=${i.id}`,
      matchedOn: 'internal or supplier invoice number',
      score: this.score(term, i.internalNo, i.supplierInvoiceNo),
      badge: i.status,
    }));
  }

  private async returns(term: string, take: number): Promise<SearchHit[]> {
    const returns = await this.prisma.returnDocument.findMany({
      where: { returnNo: { contains: term, mode: 'insensitive' } },
      select: { id: true, returnNo: true, type: true, createdAt: true },
      take,
    });

    return returns.map((r) => ({
      type: 'return',
      id: r.id,
      title: r.returnNo,
      subtitle: `${r.type} · ${r.createdAt.toISOString().slice(0, 10)}`,
      linkUrl: `/returns?id=${r.id}`,
      matchedOn: 'return number',
      score: this.score(term, r.returnNo),
    }));
  }

  private async recalls(term: string, take: number): Promise<SearchHit[]> {
    const recalls = await this.prisma.recall.findMany({
      where: {
        OR: [
          { recallNo: { contains: term, mode: 'insensitive' } },
          { regulatoryReference: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, recallNo: true, severity: true, status: true, reason: true },
      take,
    });

    return recalls.map((r) => ({
      type: 'recall',
      id: r.id,
      title: r.recallNo,
      subtitle: r.reason.slice(0, 90),
      linkUrl: `/recalls?id=${r.id}`,
      matchedOn: 'recall or regulatory reference',
      score: this.score(term, r.recallNo),
      badge: r.severity,
    }));
  }

  private async incidents(term: string, take: number): Promise<SearchHit[]> {
    const incidents = await this.prisma.qualityIncident.findMany({
      where: {
        OR: [
          { incidentNo: { contains: term, mode: 'insensitive' } },
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, incidentNo: true, title: true, description: true, status: true, severity: true },
      take,
    });

    return incidents.map((i) => ({
      type: 'incident',
      id: i.id,
      title: i.incidentNo,
      subtitle: (i.title ?? i.description).slice(0, 90),
      linkUrl: `/quality?id=${i.id}`,
      matchedOn: 'incident number or description',
      score: this.score(term, i.incidentNo),
      badge: i.severity,
    }));
  }

  private async users(term: string, take: number): Promise<SearchHit[]> {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { fullName: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, fullName: true, email: true, status: true },
      take,
    });

    return users.map((u) => ({
      type: 'user',
      id: u.id,
      title: u.fullName,
      subtitle: `${u.username} · ${u.email}`,
      linkUrl: `/admin?userId=${u.id}`,
      matchedOn: 'name, username or email',
      score: this.score(term, u.username, u.fullName, u.email),
      badge: u.status === 'ACTIVE' ? undefined : u.status,
    }));
  }
}
