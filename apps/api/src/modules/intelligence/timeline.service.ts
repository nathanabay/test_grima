import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface TimelineEvent {
  at: Date;
  /** CREATED | PRICE_CHANGED | RECEIVED | DISPENSED | SOLD | TRANSFERRED |
   *  ADJUSTED | QUARANTINED | RECALLED | DISPOSED | COUNTED | DOCUMENT |
   *  EDITED | APPROVED */
  kind: string;
  title: string;
  detail: string | null;
  actor: string | null;
  /** Where the underlying record lives, so every entry is clickable (§63). */
  linkUrl: string | null;
  sourceType: string;
  sourceId: string | null;
}

/**
 * Universal activity timeline (§63).
 *
 * Assembled from the records that already exist — the stock ledger, the audit
 * trail, price history, documents — rather than from a separate event log that
 * could drift from them. Every entry links to the transaction behind it, so
 * the timeline is a way into the evidence rather than a summary of it.
 */
/**
 * The permission each timeline requires.
 *
 * The route cannot declare this with a decorator because the answer depends on
 * the entity type in the path: a product timeline is stock data, a patient
 * timeline is clinical data, and treating them alike would let a cashier read
 * a patient's prescriptions through a URL meant for looking up a product.
 */
const TIMELINE_PERMISSION: Record<string, string> = {
  PRODUCT: 'catalog.product.READ',
  BATCH: 'inventory.batch.READ',
  PATIENT: 'dispensing.dispensing.READ',
  SUPPLIER: 'procurement.supplier.READ',
};

/** Roles with a clinical reason to see a patient's history (§25). */
const CLINICAL_ROLES = ['PHARMACIST', 'PHARMACY_ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER'];

@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async forEntity(
    entityType: string,
    entityId: string,
    user: AuthenticatedUser,
    limit = 100,
  ): Promise<{ entityType: string; entityId: string; events: TimelineEvent[] }> {
    const type = entityType.toUpperCase();
    const take = Math.min(limit, 500);

    const required = TIMELINE_PERMISSION[type];
    if (!required) {
      throw new BadRequestException(
        `No timeline is defined for '${entityType}'. Supported: ${Object.keys(TIMELINE_PERMISSION).join(', ')}.`,
      );
    }
    if (!user.permissions.includes(required)) {
      throw new ForbiddenException(`Reading a ${type.toLowerCase()} timeline requires ${required}`);
    }
    if (type === 'PATIENT' && !user.roles.some((r) => CLINICAL_ROLES.includes(r))) {
      // The permission is necessary but not sufficient: a patient timeline is
      // prescriptions, prescribers and dispensings, which only a clinical role
      // has a reason to read.
      throw new ForbiddenException('You are not authorized to view patient history');
    }

    const events =
      type === 'PRODUCT'
        ? await this.product(entityId, take)
        : type === 'BATCH'
          ? await this.batch(entityId, take)
          : type === 'PATIENT'
            ? await this.patient(entityId, user, take)
            : type === 'SUPPLIER'
              ? await this.supplier(entityId, take)
              : [];

    events.sort((a, b) => b.at.getTime() - a.at.getTime());

    if (type === 'PATIENT') {
      // Reading a patient record is itself an auditable event, whichever screen
      // it was read from (§42).
      await this.audit.record({
        userId: user.id,
        userLabel: user.fullName,
        module: 'dispensing',
        action: 'READ',
        entityType: 'Patient',
        entityId,
        reason: 'Patient timeline viewed',
      });
    }

    return { entityType: type, entityId, events: events.slice(0, take) };
  }

  /** Resolve actor ids to names in one query rather than per row. */
  private async actorNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean) as string[])];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private movementTitle(type: string, direction: 'IN' | 'OUT'): { kind: string; title: string } {
    const map: Record<string, { kind: string; title: string }> = {
      PURCHASE_RECEIPT: { kind: 'RECEIVED', title: 'Received into stock' },
      SALE: { kind: 'SOLD', title: 'Sold' },
      DISPENSING: { kind: 'DISPENSED', title: 'Dispensed' },
      TRANSFER_IN: { kind: 'TRANSFERRED', title: 'Transferred in' },
      TRANSFER_OUT: { kind: 'TRANSFERRED', title: 'Transferred out' },
      RETURN_IN: { kind: 'RETURNED', title: 'Returned to stock' },
      RETURN_OUT: { kind: 'RETURNED', title: 'Returned to supplier' },
      ADJUSTMENT: { kind: 'ADJUSTED', title: direction === 'IN' ? 'Adjusted up' : 'Adjusted down' },
      DAMAGE: { kind: 'DAMAGED', title: 'Written off as damaged' },
      EXPIRY: { kind: 'EXPIRED', title: 'Written off as expired' },
      RECALL: { kind: 'RECALLED', title: 'Recalled' },
      DISPOSAL: { kind: 'DISPOSED', title: 'Disposed' },
      STOCK_COUNT: { kind: 'COUNTED', title: 'Adjusted by a stock count' },
    };
    return map[type] ?? { kind: 'MOVED', title: type };
  }

  private async movements(where: object, take: number): Promise<TimelineEvent[]> {
    const rows = await this.prisma.inventoryTransaction.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take,
      select: {
        id: true,
        occurredAt: true,
        type: true,
        quantityIn: true,
        quantityOut: true,
        balanceAfter: true,
        referenceType: true,
        referenceId: true,
        referenceNo: true,
        reason: true,
        performedById: true,
        warehouseId: true,
      },
    });

    const actors = await this.actorNames(rows.map((r) => r.performedById));

    return rows.map((row) => {
      const direction = row.quantityIn.greaterThan(0) ? 'IN' : 'OUT';
      const quantity = direction === 'IN' ? row.quantityIn : row.quantityOut;
      const { kind, title } = this.movementTitle(row.type, direction);

      return {
        at: row.occurredAt,
        kind,
        title,
        detail:
          `${direction === 'IN' ? '+' : '-'}${quantity.toString()}, balance ${row.balanceAfter.toString()}` +
          (row.referenceNo ? ` · ${row.referenceNo}` : '') +
          (row.reason ? ` · ${row.reason}` : ''),
        actor: row.performedById ? (actors.get(row.performedById) ?? null) : null,
        linkUrl: `/inventory/ledger?transactionId=${row.id}`,
        sourceType: row.referenceType ?? 'INVENTORY_TRANSACTION',
        sourceId: row.referenceId ?? row.id,
      };
    });
  }

  private async auditEvents(
    entityType: string,
    entityId: string,
    take: number,
  ): Promise<TimelineEvent[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const actors = await this.actorNames(rows.map((r) => r.userId));

    return rows.map((row) => ({
      at: row.createdAt,
      kind:
        row.action === 'CREATE'
          ? 'CREATED'
          : row.action === 'APPROVE'
            ? 'APPROVED'
            : row.action === 'CANCEL' || row.action === 'DELETE'
              ? 'CANCELLED'
              : 'EDITED',
      title: `${row.action.toLowerCase().replace(/^./, (c) => c.toUpperCase())} ${row.entityType}`,
      detail: row.reason ?? this.describeChange(row.previousValue, row.newValue),
      actor: row.userId ? (actors.get(row.userId) ?? row.userLabel) : row.userLabel,
      linkUrl: `/admin?auditId=${row.id}`,
      sourceType: 'AUDIT_LOG',
      sourceId: row.id,
    }));
  }

  /** Summarise which fields changed, rather than dumping two JSON blobs. */
  private describeChange(previous: unknown, next: unknown): string | null {
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return null;

    const before = previous as Record<string, unknown>;
    const after = next as Record<string, unknown>;
    const changed = Object.keys(after).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    );
    if (!changed.length) return null;

    return changed
      .slice(0, 4)
      .map((key) => `${key}: ${JSON.stringify(before[key]) ?? '—'} → ${JSON.stringify(after[key])}`)
      .join(', ');
  }

  private async documents(
    entityType: string,
    entityId: string,
    take: number,
  ): Promise<TimelineEvent[]> {
    const docs = await this.prisma.document.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const actors = await this.actorNames(docs.map((d) => d.uploadedById));

    return docs.map((doc) => ({
      at: doc.createdAt,
      kind: 'DOCUMENT',
      title: `Document attached: ${doc.fileName}`,
      detail: `${doc.mimeType}, ${Math.round(doc.sizeBytes / 1024)} KB`,
      actor: doc.uploadedById ? (actors.get(doc.uploadedById) ?? null) : null,
      linkUrl: `/documents/${doc.id}`,
      sourceType: 'DOCUMENT',
      sourceId: doc.id,
    }));
  }

  private async product(productId: string, take: number): Promise<TimelineEvent[]> {
    const [product, movements, prices, audits, docs, batches] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: productId },
        select: { createdAt: true, createdById: true, genericName: true },
      }),
      this.movements({ productId }, take),
      this.prisma.priceHistory.findMany({
        where: { productId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.auditEvents('Product', productId, take),
      this.documents('PRODUCT', productId, take),
      this.prisma.batch.findMany({
        where: { productId },
        orderBy: { receivedDate: 'desc' },
        take: 20,
        select: { id: true, batchNumber: true, receivedDate: true, status: true, expiryDate: true },
      }),
    ]);

    const priceActors = await this.actorNames(prices.map((p) => p.changedById));

    const events: TimelineEvent[] = [
      ...movements,
      ...audits,
      ...docs,
      ...prices.map((p) => ({
        at: p.createdAt,
        kind: 'PRICE_CHANGED',
        title: `${p.priceType} price changed`,
        // §71: old and new value, actor and reason, all on one line.
        detail: `${p.oldValue.toString()} → ${p.newValue.toString()}${p.reason ? ` · ${p.reason}` : ''}`,
        actor: p.changedById ? (priceActors.get(p.changedById) ?? null) : null,
        linkUrl: `/products?id=${productId}&tab=pricing`,
        sourceType: 'PRICE_HISTORY',
        sourceId: p.id,
      })),
      ...batches.map((b) => ({
        at: b.receivedDate,
        kind: 'BATCH',
        title: `Batch ${b.batchNumber} received`,
        detail: `Expires ${b.expiryDate.toISOString().slice(0, 10)} · ${b.status}`,
        actor: null,
        linkUrl: `/batches?id=${b.id}`,
        sourceType: 'BATCH',
        sourceId: b.id,
      })),
    ];

    if (product) {
      events.push({
        at: product.createdAt,
        kind: 'CREATED',
        title: 'Product created',
        detail: product.genericName,
        actor: null,
        linkUrl: `/products?id=${productId}`,
        sourceType: 'PRODUCT',
        sourceId: productId,
      });
    }

    return events;
  }

  private async batch(batchId: string, take: number): Promise<TimelineEvent[]> {
    const [batch, movements, audits, docs, recalls] = await Promise.all([
      this.prisma.batch.findUnique({
        where: { id: batchId },
        select: {
          batchNumber: true,
          receivedDate: true,
          expiryDate: true,
          status: true,
          releasedAt: true,
          releasedById: true,
          qualityNotes: true,
          product: { select: { genericName: true, strength: true } },
        },
      }),
      this.movements({ batchId }, take),
      this.auditEvents('Batch', batchId, take),
      this.documents('BATCH', batchId, take),
      this.prisma.recallBatch.findMany({
        where: { batchId },
        include: {
          recall: {
            select: { id: true, recallNo: true, severity: true, reason: true, createdAt: true },
          },
        },
      }),
    ]);

    const events: TimelineEvent[] = [...movements, ...audits, ...docs];

    if (batch) {
      events.push({
        at: batch.receivedDate,
        kind: 'CREATED',
        title: `Batch ${batch.batchNumber} created`,
        detail: `${batch.product.genericName} ${batch.product.strength} · expires ${batch.expiryDate.toISOString().slice(0, 10)}`,
        actor: null,
        linkUrl: `/batches?id=${batchId}`,
        sourceType: 'BATCH',
        sourceId: batchId,
      });

      if (batch.releasedAt) {
        const actors = await this.actorNames([batch.releasedById]);
        events.push({
          at: batch.releasedAt,
          kind: 'APPROVED',
          title: 'Released by QA',
          detail: batch.qualityNotes,
          actor: batch.releasedById ? (actors.get(batch.releasedById) ?? null) : null,
          linkUrl: `/batches?id=${batchId}`,
          sourceType: 'BATCH',
          sourceId: batchId,
        });
      }
    }

    for (const link of recalls) {
      events.push({
        // The recall's own date: a RecallBatch row is created with the recall.
        at: link.recall.createdAt,
        kind: 'RECALLED',
        title: `Included in recall ${link.recall.recallNo}`,
        detail: `${link.recall.severity} · ${link.recall.reason.slice(0, 80)}`,
        actor: null,
        linkUrl: `/recalls?id=${link.recall.id}`,
        sourceType: 'RECALL',
        sourceId: link.recall.id,
      });
    }

    return events;
  }

  private async patient(
    patientId: string,
    user: AuthenticatedUser,
    take: number,
  ): Promise<TimelineEvent[]> {
    const events: TimelineEvent[] = [];

    const [patient, prescriptions, dispensings, sales, consents] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: patientId },
        select: { createdAt: true, fullName: true, patientCode: true, isAnonymized: true },
      }),
      this.prisma.prescription.findMany({
        where: { patientId },
        orderBy: { prescriptionDate: 'desc' },
        take,
        select: { id: true, prescriptionNo: true, prescriptionDate: true, status: true, prescriberName: true },
      }),
      this.prisma.dispensing.findMany({
        where: { patientId },
        orderBy: { dispensedAt: 'desc' },
        take,
        select: { id: true, dispensingNo: true, dispensedAt: true, items: { select: { id: true } } },
      }),
      this.prisma.sale.findMany({
        where: { patientId, status: 'COMPLETED' },
        orderBy: { soldAt: 'desc' },
        take,
        select: { id: true, saleNo: true, soldAt: true, grandTotal: true },
      }),
      this.prisma.patientConsent.findMany({ where: { patientId }, orderBy: { grantedAt: 'desc' } }),
    ]);

    if (patient) {
      events.push({
        at: patient.createdAt,
        kind: 'CREATED',
        title: 'Patient registered',
        detail: patient.patientCode,
        actor: null,
        linkUrl: `/patients?id=${patientId}`,
        sourceType: 'PATIENT',
        sourceId: patientId,
      });
    }

    for (const rx of prescriptions) {
      events.push({
        at: rx.prescriptionDate,
        kind: 'PRESCRIBED',
        title: `Prescription ${rx.prescriptionNo}`,
        detail: `${rx.prescriberName} · ${rx.status}`,
        actor: null,
        linkUrl: `/dispensing?prescriptionId=${rx.id}`,
        sourceType: 'PRESCRIPTION',
        sourceId: rx.id,
      });
    }

    for (const d of dispensings) {
      events.push({
        at: d.dispensedAt,
        kind: 'DISPENSED',
        title: `Dispensed ${d.dispensingNo}`,
        detail: `${d.items.length} line(s)`,
        actor: null,
        linkUrl: `/dispensing?id=${d.id}`,
        sourceType: 'DISPENSING',
        sourceId: d.id,
      });
    }

    for (const s of sales) {
      events.push({
        at: s.soldAt ?? new Date(),
        kind: 'SOLD',
        title: `Sale ${s.saleNo}`,
        detail: s.grandTotal.toString(),
        actor: null,
        linkUrl: `/pos?saleId=${s.id}`,
        sourceType: 'SALE',
        sourceId: s.id,
      });
    }

    for (const c of consents) {
      events.push({
        at: c.grantedAt,
        kind: 'CONSENT',
        title: `${c.consentType} consent ${c.granted ? 'granted' : 'refused'} (v${c.version})`,
        detail: c.withdrawnAt ? `Withdrawn ${c.withdrawnAt.toISOString().slice(0, 10)}` : c.method,
        actor: null,
        linkUrl: `/patients?id=${patientId}&tab=consent`,
        sourceType: 'PATIENT_CONSENT',
        sourceId: c.id,
      });
    }

    // §14: reading a patient's history is itself auditable.
    events.push(...(await this.auditEvents('Patient', patientId, take)));

    return events;
  }

  private async supplier(supplierId: string, take: number): Promise<TimelineEvent[]> {
    const [supplier, orders, receipts, invoices, audits, docs] = await Promise.all([
      this.prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { createdAt: true, companyName: true, code: true },
      }),
      this.prisma.purchaseOrder.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, poNo: true, createdAt: true, status: true, grandTotal: true },
      }),
      this.prisma.goodsReceipt.findMany({
        where: { supplierId },
        orderBy: { receivedAt: 'desc' },
        take,
        select: { id: true, grnNo: true, receivedAt: true, status: true },
      }),
      this.prisma.supplierInvoice.findMany({
        where: { supplierId },
        orderBy: { invoiceDate: 'desc' },
        take,
        select: { id: true, internalNo: true, invoiceDate: true, status: true, grandTotal: true },
      }),
      this.auditEvents('Supplier', supplierId, take),
      this.documents('SUPPLIER', supplierId, take),
    ]);

    const events: TimelineEvent[] = [...audits, ...docs];

    if (supplier) {
      events.push({
        at: supplier.createdAt,
        kind: 'CREATED',
        title: 'Supplier onboarded',
        detail: `${supplier.code} — ${supplier.companyName}`,
        actor: null,
        linkUrl: `/suppliers?id=${supplierId}`,
        sourceType: 'SUPPLIER',
        sourceId: supplierId,
      });
    }

    for (const o of orders) {
      events.push({
        at: o.createdAt,
        kind: 'ORDERED',
        title: `Purchase order ${o.poNo}`,
        detail: `${o.grandTotal.toString()} · ${o.status}`,
        actor: null,
        linkUrl: `/procurement?poId=${o.id}`,
        sourceType: 'PURCHASE_ORDER',
        sourceId: o.id,
      });
    }

    for (const r of receipts) {
      events.push({
        at: r.receivedAt,
        kind: 'RECEIVED',
        title: `Goods receipt ${r.grnNo}`,
        detail: r.status,
        actor: null,
        linkUrl: `/receiving?id=${r.id}`,
        sourceType: 'GOODS_RECEIPT',
        sourceId: r.id,
      });
    }

    for (const i of invoices) {
      events.push({
        at: i.invoiceDate,
        kind: 'INVOICED',
        title: `Invoice ${i.internalNo}`,
        detail: `${i.grandTotal.toString()} · ${i.status}`,
        actor: null,
        linkUrl: `/invoices?id=${i.id}`,
        sourceType: 'SUPPLIER_INVOICE',
        sourceId: i.id,
      });
    }

    return events;
  }
}
