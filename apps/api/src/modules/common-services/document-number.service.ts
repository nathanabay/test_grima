import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type DocumentKind =
  | 'PR' | 'RFQ' | 'QUO' | 'PO' | 'GRN' | 'TRF' | 'ADJ' | 'CNT'
  | 'RX' | 'DSP' | 'SALE' | 'RET' | 'RCL' | 'DIS' | 'QI' | 'EXC' | 'CASH'
  | 'INV' | 'PAY' | 'DMG' | 'REF';

/**
 * Sequential, human-readable document numbers: PO-2026-000123.
 *
 * Generated under an advisory lock inside the caller transaction so two
 * concurrent documents cannot claim the same number.
 */
@Injectable()
export class DocumentNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async next(tx: Prisma.TransactionClient, kind: DocumentKind, when = new Date()): Promise<string> {
    const year = when.getFullYear();
    const prefix = `${kind}-${year}-`;

    await this.prisma.advisoryLock(tx, `docnum:${kind}:${year}`);

    const table: Record<DocumentKind, { model: string; field: string }> = {
      PR: { model: 'purchaseRequest', field: 'requestNo' },
      RFQ: { model: 'rfq', field: 'rfqNo' },
      QUO: { model: 'supplierQuotation', field: 'quotationNo' },
      PO: { model: 'purchaseOrder', field: 'poNo' },
      GRN: { model: 'goodsReceipt', field: 'grnNo' },
      TRF: { model: 'stockTransfer', field: 'transferNo' },
      ADJ: { model: 'stockAdjustment', field: 'adjustmentNo' },
      CNT: { model: 'stockCount', field: 'countNo' },
      RX: { model: 'prescription', field: 'prescriptionNo' },
      DSP: { model: 'dispensing', field: 'dispensingNo' },
      SALE: { model: 'sale', field: 'saleNo' },
      RET: { model: 'returnDocument', field: 'returnNo' },
      RCL: { model: 'recall', field: 'recallNo' },
      DIS: { model: 'disposal', field: 'disposalNo' },
      QI: { model: 'qualityIncident', field: 'incidentNo' },
      EXC: { model: 'temperatureExcursion', field: 'excursionNo' },
      CASH: { model: 'cashSession', field: 'sessionNo' },
      INV: { model: 'supplierInvoice', field: 'internalNo' },
      PAY: { model: 'supplierPayment', field: 'paymentNo' },
      DMG: { model: 'damageReport', field: 'reportNo' },
      REF: { model: 'sale', field: 'saleNo' },
    };

    const { model, field } = table[kind];
    const last = await (tx as any)[model].findFirst({
      where: { [field]: { startsWith: prefix } },
      orderBy: { [field]: 'desc' },
      select: { [field]: true },
    });

    const lastSeq = last ? Number(String(last[field]).slice(prefix.length)) : 0;
    return `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;
  }
}
