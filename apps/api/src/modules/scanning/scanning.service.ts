import { Injectable, NotFoundException } from '@nestjs/common';
import { ParsedBarcode, normalizeGtin, parseBarcode } from '@pharmacore/shared';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Every equivalent way the same GTIN may be stored: the 14-digit normalized
 * form, and the shorter forms produced by stripping leading zeros (GTIN-13,
 * GTIN-12, GTIN-8).
 */
function gtinEquivalents(gtin: string): string[] {
  const padded = normalizeGtin(gtin);
  const forms = new Set<string>([gtin, padded]);

  // Shorter forms are only equivalent when the digits being dropped are zeros.
  // A GTIN-14 with a non-zero indicator digit (e.g. 1890...) identifies a case,
  // which is a DIFFERENT trade item from the inner pack - never conflate them.
  for (const length of [13, 12, 8]) {
    if (padded.length > length && /^0+$/.test(padded.slice(0, padded.length - length))) {
      forms.add(padded.slice(padded.length - length));
    }
  }

  return Array.from(forms).filter((f) => /^\d{8,14}$/.test(f));
}

export interface ScanResolution {
  parsed: ParsedBarcode;
  product: {
    id: string;
    sku: string;
    genericName: string;
    brandName: string | null;
    strength: string;
    dosageForm: string;
    baseUnit: string;
    isControlled: boolean;
    requiresPrescription: boolean;
    isColdChain: boolean;
  } | null;
  batch: {
    id: string;
    batchNumber: string;
    expiryDate: Date;
    status: string;
  } | null;
  /** Present when the code carried a serial that we know about. */
  serial: { id: string; serial: string; status: string } | null;
  warnings: string[];
}

/**
 * Barcode and GS1 DataMatrix resolution (§17).
 *
 * Resolves a raw scan to master data. Batch and expiry are only trusted when
 * the code was a genuine GS1 element string - a plain QR or Code 128 is never
 * treated as pharmaceutical identification (§62, §73).
 */
@Injectable()
export class ScanningService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(raw: string): Promise<ScanResolution> {
    const parsed = parseBarcode(raw);
    const warnings: string[] = [...parsed.errors];

    let product: ScanResolution['product'] = null;

    if (parsed.gtin) {
      // A GS1 code always carries a 14-digit GTIN, but master data may hold the
      // same product as a 12- or 13-digit UPC/EAN. Match every equivalent
      // representation rather than only the padded form.
      const candidates = gtinEquivalents(parsed.gtin);
      product = await this.prisma.product.findFirst({
        where: {
          OR: [
            { gtin: { in: candidates } },
            { barcodes: { some: { barcode: { in: candidates } } } },
          ],
        },
        select: {
          id: true,
          sku: true,
          genericName: true,
          brandName: true,
          strength: true,
          dosageForm: true,
          baseUnit: true,
          isControlled: true,
          requiresPrescription: true,
          isColdChain: true,
        },
      });
    } else {
      // Non-GS1 linear barcode: look it up in the barcode table directly.
      const match = await this.prisma.productBarcode.findFirst({
        where: { barcode: parsed.raw },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              genericName: true,
              brandName: true,
              strength: true,
              dosageForm: true,
              baseUnit: true,
              isControlled: true,
              requiresPrescription: true,
              isColdChain: true,
            },
          },
        },
      });
      product = match?.product ?? null;
    }

    if (!product) {
      warnings.push('No product in the drug master matches this code');
    }
    if (!parsed.isGs1) {
      warnings.push(
        'This is not a GS1 DataMatrix. Batch and expiry must be entered and verified manually.',
      );
    }

    let batch: ScanResolution['batch'] = null;
    if (product && parsed.batchNumber) {
      batch = await this.prisma.batch.findFirst({
        where: { productId: product.id, batchNumber: parsed.batchNumber },
        select: { id: true, batchNumber: true, expiryDate: true, status: true },
      });

      if (!batch) {
        warnings.push(
          `Batch ${parsed.batchNumber} is not yet registered for this product`,
        );
      } else {
        if (parsed.expiryDate) {
          const scanned = parsed.expiryDate.toISOString().slice(0, 10);
          const stored = batch.expiryDate.toISOString().slice(0, 10);
          if (scanned !== stored) {
            warnings.push(
              `Expiry mismatch: the pack says ${scanned} but batch ${batch.batchNumber} is recorded as ${stored}`,
            );
          }
        }
        if (batch.expiryDate.getTime() < Date.now()) {
          warnings.push(`EXPIRED: batch ${batch.batchNumber} expired on ${batch.expiryDate.toISOString().slice(0, 10)}`);
        }
        if (!['AVAILABLE', 'RELEASED'].includes(batch.status)) {
          warnings.push(`Batch ${batch.batchNumber} is ${batch.status} and cannot be dispensed or sold`);
        }
      }
    }

    let serial: ScanResolution['serial'] = null;
    if (parsed.serialNumber) {
      serial = await this.prisma.serialNumber.findFirst({
        where: { serial: parsed.serialNumber },
        select: { id: true, serial: true, status: true },
      });
      if (serial && serial.status !== 'IN_STOCK') {
        warnings.push(`Serial ${serial.serial} is already marked ${serial.status}`);
      }
    }

    return { parsed, product, batch, serial, warnings };
  }

  /** Resolve or fail — used by workflows that cannot proceed without a match. */
  async resolveOrFail(raw: string): Promise<ScanResolution> {
    const result = await this.resolve(raw);
    if (!result.product) {
      throw new NotFoundException(
        `Scanned code "${raw.slice(0, 40)}" does not match any product in the drug master`,
      );
    }
    return result;
  }
}
