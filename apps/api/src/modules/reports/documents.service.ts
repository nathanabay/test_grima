import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ExportService } from './export.service';

const money = (n: unknown) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : '-');

export type DocumentKind =
  | 'purchase-request'
  | 'rfq'
  | 'purchase-order'
  | 'goods-receipt'
  | 'stock-transfer'
  | 'sales-invoice'
  | 'dispensing-record'
  | 'return-note'
  | 'recall-report'
  | 'stock-count'
  | 'disposal-certificate';

/**
 * Printable business documents (§63).
 *
 * Rendered as self-contained HTML with print styles; the browser's print-to-PDF
 * produces the file. That keeps Amharic and Latin script rendering correct
 * without embedding font subsets in a PDF engine.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exporter: ExportService,
  ) {}

  private async organization() {
    return this.prisma.organization.findFirstOrThrow();
  }

  async render(kind: DocumentKind, id: string): Promise<string> {
    switch (kind) {
      case 'purchase-order':
        return this.purchaseOrder(id);
      case 'goods-receipt':
        return this.goodsReceipt(id);
      case 'stock-transfer':
        return this.stockTransfer(id);
      case 'sales-invoice':
        return this.salesInvoice(id);
      case 'dispensing-record':
        return this.dispensingRecord(id);
      case 'return-note':
        return this.returnNote(id);
      case 'recall-report':
        return this.recallReport(id);
      case 'stock-count':
        return this.stockCountSheet(id);
      case 'disposal-certificate':
        return this.disposalCertificate(id);
      case 'purchase-request':
        return this.purchaseRequest(id);
      case 'rfq':
        return this.rfq(id);
      default:
        throw new NotFoundException(`Unknown document type "${kind}"`);
    }
  }

  private async purchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { items: true, supplier: true },
    });
    const org = await this.organization();
    const products = await this.productMap(po.items.map((i) => i.productId));

    return this.exporter.toPrintableHtml({
      title: 'Purchase Order',
      subtitle: po.poNo,
      organization: org,
      meta: [
        ['Supplier', po.supplier.companyName],
        ['Supplier code', po.supplier.code],
        ['Payment terms', po.supplier.paymentTerms ?? '-'],
        ['Order date', date(po.orderDate)],
        ['Expected delivery', date(po.expectedDate)],
        ['Status', po.status],
        ['Currency', po.currency],
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 240 },
        { key: 'orderedQty', label: 'Quantity', type: 'number' },
        { key: 'unitPrice', label: 'Unit price', type: 'money' },
        { key: 'taxRate', label: 'Tax %', type: 'number' },
        { key: 'lineTotal', label: 'Line total', type: 'money' },
      ],
      rows: po.items.map((i) => {
        const p = products.get(i.productId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength} (${p.dosageForm})` : '-',
          orderedQty: Number(i.orderedQty),
          unitPrice: Number(i.unitPrice),
          taxRate: Number(i.taxRate) * 100,
          lineTotal: Number(i.lineTotal),
        };
      }),
      totals: [
        ['Subtotal', money(po.subtotal)],
        ['Tax', money(po.taxTotal)],
        ['Freight', money(po.freightCost)],
        ['Grand total', `${po.currency} ${money(po.grandTotal)}`],
      ],
      footNote: 'Authorised signature',
    });
  }

  private async goodsReceipt(id: string) {
    const grn = await this.prisma.goodsReceipt.findUniqueOrThrow({
      where: { id },
      include: { items: true, purchaseOrder: { select: { poNo: true } } },
    });
    const org = await this.organization();
    const supplier = await this.prisma.supplier.findUnique({ where: { id: grn.supplierId } });
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: grn.warehouseId } });
    const products = await this.productMap(grn.items.map((i) => i.productId));

    return this.exporter.toPrintableHtml({
      title: 'Goods Receipt Note',
      subtitle: grn.grnNo,
      organization: org,
      meta: [
        ['Supplier', supplier?.companyName ?? '-'],
        ['Purchase order', grn.purchaseOrder?.poNo ?? '-'],
        ['Supplier invoice', grn.supplierInvoiceNo ?? '-'],
        ['Warehouse', warehouse?.name ?? '-'],
        ['Received', date(grn.receivedAt)],
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 200 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'expiryDate', label: 'Expiry', type: 'date' },
        { key: 'receivedQty', label: 'Received', type: 'number' },
        { key: 'acceptedQty', label: 'Accepted', type: 'number' },
        { key: 'rejectedQty', label: 'Rejected', type: 'number' },
        { key: 'unitCost', label: 'Unit cost', type: 'money' },
        { key: 'flags', label: 'Exceptions', width: 200 },
      ],
      rows: grn.items.map((i) => {
        const p = products.get(i.productId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength}` : '-',
          batchNumber: i.batchNumber,
          expiryDate: i.expiryDate,
          receivedQty: Number(i.receivedQty),
          acceptedQty: Number(i.acceptedQty),
          rejectedQty: Number(i.rejectedQty),
          unitCost: Number(i.unitCost),
          flags: i.flags.join('; ') || 'none',
        };
      }),
      footNote: 'Received by / Inspected by',
    });
  }

  private async stockTransfer(id: string) {
    const transfer = await this.prisma.stockTransfer.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    const org = await this.organization();
    const [from, to] = await Promise.all([
      this.prisma.warehouse.findUnique({ where: { id: transfer.fromWarehouseId } }),
      this.prisma.warehouse.findUnique({ where: { id: transfer.toWarehouseId } }),
    ]);
    const products = await this.productMap(transfer.items.map((i) => i.productId));
    const batches = await this.batchMap(transfer.items.map((i) => i.batchId));

    return this.exporter.toPrintableHtml({
      title: 'Stock Transfer Note',
      subtitle: transfer.transferNo,
      organization: org,
      meta: [
        ['From', from?.name ?? '-'],
        ['To', to?.name ?? '-'],
        ['Status', transfer.status],
        ['Dispatched', date(transfer.dispatchedAt)],
        ['Courier / vehicle', transfer.vehicleOrCourier ?? '-'],
        ...(transfer.isRecallMovement ? ([['Recall movement', 'YES']] as Array<[string, string]>) : []),
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 220 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'expiryDate', label: 'Expiry', type: 'date' },
        { key: 'requestedQty', label: 'Requested', type: 'number' },
        { key: 'dispatchedQty', label: 'Dispatched', type: 'number' },
        { key: 'receivedQty', label: 'Received', type: 'number' },
      ],
      rows: transfer.items.map((i) => {
        const p = products.get(i.productId);
        const b = batches.get(i.batchId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength}` : '-',
          batchNumber: b?.batchNumber ?? '-',
          expiryDate: b?.expiryDate ?? null,
          requestedQty: Number(i.requestedQty),
          dispatchedQty: Number(i.dispatchedQty),
          receivedQty: Number(i.receivedQty),
        };
      }),
      footNote: 'Dispatched by / Received by',
    });
  }

  private async salesInvoice(id: string) {
    const sale = await this.prisma.sale.findUniqueOrThrow({
      where: { id },
      include: { items: true, payments: true, patient: true },
    });
    const org = await this.organization();
    const products = await this.productMap(sale.items.map((i) => i.productId));
    const batches = await this.batchMap(sale.items.map((i) => i.batchId));

    return this.exporter.toPrintableHtml({
      title: 'Sales Invoice',
      subtitle: sale.saleNo,
      organization: org,
      meta: [
        ['Date', date(sale.soldAt)],
        ['Customer', sale.patient?.fullName ?? 'Walk-in'],
        ['Status', sale.status],
        ['Payment', sale.payments.map((p) => `${p.method} ${money(p.amount)}`).join(', ') || '-'],
      ],
      columns: [
        { key: 'product', label: 'Product', width: 240 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'quantity', label: 'Qty', type: 'number' },
        { key: 'unitPrice', label: 'Unit price', type: 'money' },
        { key: 'taxRate', label: 'Tax %', type: 'number' },
        { key: 'lineTotal', label: 'Total', type: 'money' },
      ],
      rows: sale.items.map((i) => {
        const p = products.get(i.productId);
        return {
          product: p ? `${p.genericName} ${p.strength}` : '-',
          batchNumber: batches.get(i.batchId)?.batchNumber ?? '-',
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          taxRate: Number(i.taxRate) * 100,
          lineTotal: Number(i.lineTotal),
        };
      }),
      totals: [
        ['Subtotal', money(sale.subtotal)],
        ['Discount', money(sale.discountTotal)],
        ['Tax', money(sale.taxTotal)],
        ['Total', money(sale.grandTotal)],
      ],
    });
  }

  private async dispensingRecord(id: string) {
    const dispensing = await this.prisma.dispensing.findUniqueOrThrow({
      where: { id },
      include: { items: true, prescription: true },
    });
    const org = await this.organization();
    const patient = dispensing.patientId
      ? await this.prisma.patient.findUnique({ where: { id: dispensing.patientId } })
      : null;
    const pharmacist = await this.prisma.user.findUnique({
      where: { id: dispensing.pharmacistId },
      select: { fullName: true, licenseNumber: true },
    });
    const products = await this.productMap(dispensing.items.map((i) => i.productId));
    const batches = await this.batchMap(dispensing.items.map((i) => i.batchId));

    return this.exporter.toPrintableHtml({
      title: 'Prescription Dispensing Record',
      subtitle: dispensing.dispensingNo,
      organization: org,
      meta: [
        ['Patient', patient ? `${patient.fullName} (${patient.patientCode})` : '-'],
        ['Prescription', dispensing.prescription?.prescriptionNo ?? '-'],
        ['Prescriber', dispensing.prescription?.prescriberName ?? '-'],
        ['Dispensed', date(dispensing.dispensedAt)],
        ['Pharmacist', `${pharmacist?.fullName ?? '-'}${pharmacist?.licenseNumber ? ` (${pharmacist.licenseNumber})` : ''}`],
      ],
      columns: [
        { key: 'product', label: 'Medicine', width: 240 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'expiryDate', label: 'Expiry', type: 'date' },
        { key: 'quantity', label: 'Quantity', type: 'number' },
        { key: 'override', label: 'FEFO override', width: 220 },
      ],
      rows: dispensing.items.map((i) => {
        const p = products.get(i.productId);
        const b = batches.get(i.batchId);
        return {
          product: p ? `${p.genericName} ${p.strength} (${p.dosageForm})` : '-',
          batchNumber: b?.batchNumber ?? '-',
          expiryDate: b?.expiryDate ?? null,
          quantity: Number(i.quantity),
          override: i.overrideReason ?? '-',
        };
      }),
      footNote: 'Dispensed by (signature)',
    });
  }

  private async returnNote(id: string) {
    const doc = await this.prisma.returnDocument.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    const org = await this.organization();
    const products = await this.productMap(doc.items.map((i) => i.productId));
    const batches = await this.batchMap(doc.items.map((i) => i.batchId));

    return this.exporter.toPrintableHtml({
      title: 'Return Note',
      subtitle: doc.returnNo,
      organization: org,
      meta: [
        ['Type', doc.type],
        ['Status', doc.status],
        ['Raised', date(doc.createdAt)],
        ['Inspected', date(doc.inspectedAt)],
        ['Reason', doc.reason],
      ],
      columns: [
        { key: 'product', label: 'Product', width: 240 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'quantity', label: 'Quantity', type: 'number' },
        { key: 'condition', label: 'Condition' },
        { key: 'disposition', label: 'Disposition' },
        { key: 'dispositionNotes', label: 'Notes', width: 200 },
      ],
      rows: doc.items.map((i) => {
        const p = products.get(i.productId);
        return {
          product: p ? `${p.genericName} ${p.strength}` : '-',
          batchNumber: batches.get(i.batchId)?.batchNumber ?? '-',
          quantity: Number(i.quantity),
          condition: i.condition ?? '-',
          disposition: i.disposition,
          dispositionNotes: i.dispositionNotes ?? '',
        };
      }),
      footNote: 'Returned by / Inspected by',
    });
  }

  private async recallReport(id: string) {
    const recall = await this.prisma.recall.findUniqueOrThrow({
      where: { id },
      include: {
        batches: {
          include: {
            batch: { include: { product: { select: { genericName: true, strength: true, sku: true } } } },
          },
        },
        tasks: true,
      },
    });
    const org = await this.organization();

    const pending = recall.tasks.filter((t) => t.status === 'PENDING').length;
    const totals = recall.batches.reduce(
      (acc, rb) => {
        acc.affected += Number(rb.quantityInStockAtActivation) + Number(rb.quantityDispensedHistorical);
        acc.recovered += Number(rb.quantityRecovered) + Number(rb.quantityReturned) + Number(rb.quantityDestroyed);
        return acc;
      },
      { affected: 0, recovered: 0 },
    );

    return this.exporter.toPrintableHtml({
      title: 'Drug Recall Report',
      subtitle: recall.recallNo,
      organization: org,
      meta: [
        ['Classification', recall.severity],
        ['Status', recall.status],
        ['Raised', date(recall.recallDate)],
        ['Regulatory reference', recall.regulatoryReference ?? '-'],
        ['Reason', recall.reason],
        ['Instructions', recall.instructions ?? '-'],
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 220 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'expiryDate', label: 'Expiry', type: 'date' },
        { key: 'inStock', label: 'In stock', type: 'number' },
        { key: 'dispensed', label: 'Dispensed', type: 'number' },
        { key: 'recovered', label: 'Recovered', type: 'number' },
        { key: 'destroyed', label: 'Destroyed', type: 'number' },
        { key: 'outstanding', label: 'Outstanding', type: 'number' },
      ],
      rows: recall.batches.map((rb) => {
        const affected =
          Number(rb.quantityInStockAtActivation) + Number(rb.quantityDispensedHistorical);
        const accounted =
          Number(rb.quantityRecovered) + Number(rb.quantityReturned) + Number(rb.quantityDestroyed);
        return {
          sku: rb.batch.product.sku,
          product: `${rb.batch.product.genericName} ${rb.batch.product.strength}`,
          batchNumber: rb.batch.batchNumber,
          expiryDate: rb.batch.expiryDate,
          inStock: Number(rb.quantityInStockAtActivation),
          dispensed: Number(rb.quantityDispensedHistorical),
          recovered: Number(rb.quantityRecovered),
          destroyed: Number(rb.quantityDestroyed),
          outstanding: affected - accounted,
        };
      }),
      totals: [
        ['Total affected units', String(totals.affected)],
        ['Accounted for', String(totals.recovered)],
        ['Outstanding', String(totals.affected - totals.recovered)],
        ['Tasks still pending', String(pending)],
      ],
      footNote: 'Quality Assurance Officer',
    });
  }

  private async stockCountSheet(id: string) {
    const count = await this.prisma.stockCount.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    const org = await this.organization();
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: count.warehouseId } });
    const products = await this.productMap(count.items.map((i) => i.productId));
    const batches = await this.batchMap(count.items.map((i) => i.batchId));

    return this.exporter.toPrintableHtml({
      title: 'Physical Stock Count Sheet',
      subtitle: count.countNo,
      organization: org,
      meta: [
        ['Warehouse', warehouse?.name ?? '-'],
        ['Type', count.countType],
        ['Status', count.status],
        ['Started', date(count.startedAt)],
        ['Completed', date(count.completedAt)],
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 220 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'systemQty', label: 'System', type: 'number' },
        { key: 'countedQty', label: 'Counted', type: 'number' },
        { key: 'varianceQty', label: 'Variance', type: 'number' },
        { key: 'varianceValue', label: 'Variance value', type: 'money' },
        { key: 'reason', label: 'Reason', width: 200 },
      ],
      rows: count.items.map((i) => {
        const p = products.get(i.productId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength}` : '-',
          batchNumber: i.batchId ? (batches.get(i.batchId)?.batchNumber ?? '-') : '-',
          systemQty: Number(i.systemQty),
          countedQty: i.countedQty === null ? '' : Number(i.countedQty),
          varianceQty: Number(i.varianceQty),
          varianceValue: Number(i.varianceValue),
          reason: i.reason ?? '',
        };
      }),
      footNote: 'Counted by / Verified by / Approved by',
    });
  }

  private async disposalCertificate(id: string) {
    const disposal = await this.prisma.disposal.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    const org = await this.organization();
    const products = await this.productMap(disposal.items.map((i) => i.productId));
    const batches = await this.batchMap(disposal.items.map((i) => i.batchId));

    return this.exporter.toPrintableHtml({
      title: 'Certificate of Disposal',
      subtitle: disposal.disposalNo,
      organization: org,
      meta: [
        ['Method', disposal.method],
        ['Status', disposal.status],
        ['Disposed on', date(disposal.disposedAt)],
        ['Certificate number', disposal.certificateNo ?? '-'],
        ['Witness', disposal.witnessName ?? '-'],
        ['Reason', disposal.reason],
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 240 },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'expiryDate', label: 'Expiry', type: 'date' },
        { key: 'quantity', label: 'Quantity', type: 'number' },
        { key: 'unitCost', label: 'Unit cost', type: 'money' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: disposal.items.map((i) => {
        const p = products.get(i.productId);
        const b = batches.get(i.batchId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength}` : '-',
          batchNumber: b?.batchNumber ?? '-',
          expiryDate: b?.expiryDate ?? null,
          quantity: Number(i.quantity),
          unitCost: Number(i.unitCost),
          value: Number(i.quantity) * Number(i.unitCost),
        };
      }),
      totals: [['Total value destroyed', money(disposal.totalCostValue)]],
      footNote:
        'We certify that the pharmaceutical products listed above were destroyed by the stated method, in the presence of the named witness.',
    });
  }

  private async purchaseRequest(id: string) {
    const pr = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    const org = await this.organization();
    const products = await this.productMap(pr.items.map((i) => i.productId));

    return this.exporter.toPrintableHtml({
      title: 'Purchase Request',
      subtitle: pr.requestNo,
      organization: org,
      meta: [
        ['Status', pr.status],
        ['Department', pr.department ?? '-'],
        ['Required by', date(pr.requiredBy)],
        ['Reason', pr.reason ?? '-'],
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 240 },
        { key: 'requestedQty', label: 'Requested', type: 'number' },
        { key: 'currentStock', label: 'Current stock', type: 'number' },
        { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
        { key: 'forecastDemand', label: 'Forecast demand', type: 'number' },
        { key: 'notes', label: 'Notes', width: 200 },
      ],
      rows: pr.items.map((i) => {
        const p = products.get(i.productId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength}` : '-',
          requestedQty: Number(i.requestedQty),
          currentStock: Number(i.currentStock),
          reorderLevel: Number(i.reorderLevel),
          forecastDemand: Number(i.forecastDemand),
          notes: i.notes ?? '',
        };
      }),
      footNote: 'Requested by / Approved by',
    });
  }

  private async rfq(id: string) {
    const rfq = await this.prisma.rfq.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    const org = await this.organization();
    const products = await this.productMap(rfq.items.map((i) => i.productId));

    return this.exporter.toPrintableHtml({
      title: 'Request for Quotation',
      subtitle: rfq.rfqNo,
      organization: org,
      meta: [
        ['Issued', date(rfq.issuedAt)],
        ['Closes', date(rfq.closesAt)],
        ['Status', rfq.status],
      ],
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 260 },
        { key: 'quantity', label: 'Quantity required', type: 'number' },
        { key: 'unitPrice', label: 'Your unit price' },
        { key: 'shelfLife', label: 'Shelf life offered' },
        { key: 'delivery', label: 'Delivery (days)' },
      ],
      rows: rfq.items.map((i) => {
        const p = products.get(i.productId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength} (${p.dosageForm})` : '-',
          quantity: Number(i.quantity),
          // Blank columns for the supplier to complete by hand.
          unitPrice: '',
          shelfLife: '',
          delivery: '',
        };
      }),
      footNote: 'Supplier name / Authorised signature / Date',
    });
  }

  // ---- Lookup helpers ----

  private async productMap(ids: string[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: Array.from(new Set(ids)) } },
      select: { id: true, sku: true, genericName: true, strength: true, dosageForm: true },
    });
    return new Map(products.map((p) => [p.id, p]));
  }

  private async batchMap(ids: Array<string | null>) {
    const clean = ids.filter((i): i is string => !!i);
    const batches = await this.prisma.batch.findMany({
      where: { id: { in: Array.from(new Set(clean)) } },
      select: { id: true, batchNumber: true, expiryDate: true },
    });
    return new Map(batches.map((b) => [b.id, b]));
  }
}
