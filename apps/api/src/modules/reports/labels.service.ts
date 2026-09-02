import { BadRequestException, Injectable } from '@nestjs/common';
import { buildLabelBarcode, encodeCode128, renderBarcodeSvg } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

export type LabelKind = 'product' | 'shelf' | 'bin' | 'batch' | 'transfer';

export interface LabelRequest {
  kind: LabelKind;
  /** Ids of the products / locations / batches / transfers to label. */
  ids: string[];
  /** Copies of each label; a shelf-edge reprint is usually one, a batch many. */
  copies?: number;
  /** Label stock, in millimetres. Defaults to a common 63.5 x 38.1 grid. */
  widthMm?: number;
  heightMm?: number;
}

interface LabelContent {
  title: string;
  lines: string[];
  barcodeSvg: string;
  symbology: string;
  warning?: string;
}

/**
 * Label printing (§62).
 *
 * Produces a print-ready sheet of labels laid out on a grid, sized in
 * millimetres so it matches physical label stock. Barcodes are SVG, so they
 * print at the printer's resolution instead of being resampled.
 */
@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async render(request: LabelRequest): Promise<string> {
    if (!request.ids?.length) {
      throw new BadRequestException('Select at least one record to label');
    }
    const copies = Math.min(Math.max(request.copies ?? 1, 1), 200);
    const width = request.widthMm ?? 63.5;
    const height = request.heightMm ?? 38.1;

    const labels = await this.buildLabels(request);
    const expanded = labels.flatMap((l) => Array.from({ length: copies }, () => l));
    const org = await this.prisma.organization.findFirstOrThrow();

    return this.sheet(expanded, { width, height, organization: org.name });
  }

  private async buildLabels(request: LabelRequest): Promise<LabelContent[]> {
    switch (request.kind) {
      case 'product':
        return this.productLabels(request.ids);
      case 'batch':
        return this.batchLabels(request.ids);
      case 'shelf':
        return this.shelfLabels(request.ids);
      case 'bin':
        return this.binLabels(request.ids);
      case 'transfer':
        return this.transferLabels(request.ids);
      default:
        throw new BadRequestException(`Unknown label kind "${request.kind}"`);
    }
  }

  private async productLabels(ids: string[]): Promise<LabelContent[]> {
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { manufacturer: { select: { name: true } } },
    });

    return products.map((p) => {
      const barcode = p.gtin
        ? buildLabelBarcode({ gtin: p.gtin })
        : {
            svg: renderBarcodeSvg(encodeCode128(p.sku)),
            symbology: 'CODE128',
            encoded: p.sku,
          };

      return {
        title: `${p.genericName} ${p.strength}`,
        lines: [
          p.brandName ? `${p.brandName} · ${p.dosageForm}` : p.dosageForm,
          p.manufacturer?.name ?? '',
          `SKU ${p.sku}`,
          `${p.retailPrice.toString()} per ${p.baseUnit.toLowerCase()}`,
        ].filter(Boolean),
        barcodeSvg: barcode.svg,
        symbology: barcode.symbology,
        warning: [
          p.isControlled && 'CONTROLLED',
          p.requiresPrescription && !p.isControlled && 'PRESCRIPTION ONLY',
          p.isColdChain && 'KEEP 2-8C',
          p.isHighAlert && 'HIGH ALERT',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      };
    });
  }

  private async batchLabels(ids: string[]): Promise<LabelContent[]> {
    const batches = await this.prisma.batch.findMany({
      where: { id: { in: ids } },
      include: { product: true },
    });

    return batches.map((b) => {
      // A batch label must carry batch and expiry, so it is always GS1-bearing.
      const barcode = buildLabelBarcode({
        gtin: b.product.gtin ?? b.product.sku,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate,
      });

      return {
        title: `${b.product.genericName} ${b.product.strength}`,
        lines: [
          `Batch ${b.batchNumber}`,
          `Expires ${b.expiryDate.toISOString().slice(0, 10)}`,
          b.manufacturerName ?? '',
          `Status ${b.status}`,
        ].filter(Boolean),
        barcodeSvg: barcode.svg,
        symbology: barcode.symbology,
        warning:
          b.status !== 'AVAILABLE' && b.status !== 'RELEASED'
            ? `${b.status} — DO NOT DISPENSE`
            : b.product.isColdChain
              ? 'KEEP 2-8C'
              : undefined,
      };
    });
  }

  private async shelfLabels(ids: string[]): Promise<LabelContent[]> {
    // A shelf label identifies the product at a shelf edge, with its price.
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { productId: { in: ids } },
      include: { product: true, location: true, warehouse: { select: { name: true } } },
      distinct: ['productId'],
    });

    return balances.map((b) => {
      const barcode = b.product.gtin
        ? buildLabelBarcode({ gtin: b.product.gtin })
        : {
            svg: renderBarcodeSvg(encodeCode128(b.product.sku)),
            symbology: 'CODE128',
            encoded: b.product.sku,
          };

      return {
        title: `${b.product.genericName} ${b.product.strength}`,
        lines: [
          b.product.brandName ?? '',
          `${b.product.retailPrice.toString()} per ${b.product.baseUnit.toLowerCase()}`,
          b.location ? `Location ${b.location.code}` : b.warehouse.name,
        ].filter(Boolean),
        barcodeSvg: barcode.svg,
        symbology: barcode.symbology,
        warning: b.product.requiresPrescription ? 'PRESCRIPTION ONLY' : undefined,
      };
    });
  }

  private async binLabels(ids: string[]): Promise<LabelContent[]> {
    const locations = await this.prisma.warehouseLocation.findMany({
      where: { id: { in: ids } },
      include: { warehouse: { select: { name: true, code: true } }, parent: true },
    });

    return locations.map((l) => ({
      title: l.code,
      lines: [l.name, l.warehouse.name, l.parent ? `Within ${l.parent.code}` : l.level].filter(Boolean),
      barcodeSvg: renderBarcodeSvg(encodeCode128(l.code), { heightMm: 16 }),
      symbology: 'CODE128',
    }));
  }

  private async transferLabels(ids: string[]): Promise<LabelContent[]> {
    const transfers = await this.prisma.stockTransfer.findMany({
      where: { id: { in: ids } },
      include: { items: true },
    });
    const warehouses = await this.prisma.warehouse.findMany({ select: { id: true, name: true } });
    const nameOf = new Map(warehouses.map((w) => [w.id, w.name]));

    return transfers.map((t) => ({
      title: t.transferNo,
      lines: [
        `From ${nameOf.get(t.fromWarehouseId) ?? '-'}`,
        `To ${nameOf.get(t.toWarehouseId) ?? '-'}`,
        `${t.items.length} line(s)`,
        t.vehicleOrCourier ? `Via ${t.vehicleOrCourier}` : '',
      ].filter(Boolean),
      barcodeSvg: renderBarcodeSvg(encodeCode128(t.transferNo), { heightMm: 16 }),
      symbology: 'CODE128',
      warning: t.isRecallMovement ? 'RECALL MOVEMENT' : undefined,
    }));
  }

  private sheet(
    labels: LabelContent[],
    options: { width: number; height: number; organization: string },
  ): string {
    const cells = labels
      .map(
        (l) => `
  <div class="label">
    ${l.warning ? `<div class="warn">${escapeHtml(l.warning)}</div>` : ''}
    <div class="title">${escapeHtml(l.title)}</div>
    <div class="lines">${l.lines.map((x) => `<div>${escapeHtml(x)}</div>`).join('')}</div>
    <div class="code">${l.barcodeSvg}</div>
  </div>`,
      )
      .join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Labels — ${escapeHtml(options.organization)}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; }
  .sheet { display: flex; flex-wrap: wrap; gap: 2mm; }
  .label {
    width: ${options.width}mm; height: ${options.height}mm;
    border: 0.2mm dashed #cbd5e1; padding: 1.5mm;
    display: flex; flex-direction: column; justify-content: space-between;
    overflow: hidden; page-break-inside: avoid;
  }
  .title { font-size: 2.9mm; font-weight: 700; line-height: 1.15; }
  .lines { font-size: 2.2mm; color: #334155; line-height: 1.25; }
  .warn {
    font-size: 2.1mm; font-weight: 700; color: #fff; background: #b91c1c;
    padding: 0.4mm 1mm; border-radius: 0.6mm; align-self: flex-start; margin-bottom: 0.6mm;
  }
  .code { margin-top: auto; }
  .code svg { display: block; width: 100%; height: auto; }
  @media print { .label { border-color: transparent; } .no-print { display: none; } }
</style>
</head>
<body>
<div class="no-print" style="padding:4mm;font-size:3mm;color:#475569">
  ${labels.length} label(s) on ${options.width} x ${options.height} mm stock.
  Print at 100% scale — any scaling changes the barcode module width and may stop it scanning.
</div>
<div class="sheet">${cells}</div>
<script>
  if (!new URLSearchParams(location.search).has('noprint')) {
    window.addEventListener('load', () => setTimeout(() => window.print(), 300));
  }
</script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
