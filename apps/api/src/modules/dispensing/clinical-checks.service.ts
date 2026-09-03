import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '../../common/config/config.service';

export type WarningSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ClinicalWarning {
  /** Stable code, so an override can name exactly what was overridden. */
  code: string;
  severity: WarningSeverity;
  productId: string;
  product: string;
  message: string;
  /** What the pharmacist should do about it. A warning with no action is noise. */
  action: string;
}

/**
 * Clinical checks at the point of dispensing (§24).
 *
 * Everything here is ADVISORY. Not one of these checks refuses a supply: the
 * pharmacist is the clinician, they can see the patient, and a system that
 * blocks a legitimate supply because a free-text allergy field contains a word
 * is a system people learn to work around.
 *
 * What the system does insist on is that a warning cannot be passed silently.
 * A CRITICAL warning must be overridden explicitly, with a reason, and the
 * override is recorded on the dispensing and in the audit trail. The record of
 * the decision is the deliverable, not the decision itself.
 *
 * The allergy data is free text, because that is what a pharmacy counter
 * actually collects. Matching it is therefore a word-level comparison against
 * generic names and active ingredients, and it is stated plainly as such:
 * treating a fuzzy match as authoritative would be worse than not checking.
 */
@Injectable()
export class ClinicalChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reduce free text to comparable words.
   *
   * Short fragments are dropped: matching on "ace" would flag half the
   * formulary, and a false alarm every time is how a real alarm gets ignored.
   */
  private tokenize(text: string | null | undefined): Set<string> {
    if (!text) return new Set();
    return new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 4),
    );
  }

  async check(input: {
    patientId?: string | null;
    branchId: string;
    lines: Array<{ productId: string; quantity: number; prescriptionItemId?: string }>;
    prescription?: {
      id: string;
      prescriptionDate: Date;
      validUntil: Date | null;
      refillsAllowed: number;
      refillsUsed: number;
      items: Array<{
        id: string;
        productId: string;
        durationDays: number | null;
        prescribedQty: Prisma.Decimal;
        frequency: string | null;
      }>;
    } | null;
  }): Promise<ClinicalWarning[]> {
    const warnings: ClinicalWarning[] = [];
    const productIds = input.lines.map((l) => l.productId);
    if (!productIds.length) return warnings;

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        genericName: true,
        brandName: true,
        strength: true,
        baseUnit: true,
        isPediatric: true,
        isLookAlikeSoundAlike: true,
        isColdChain: true,
        isControlled: true,
        renalCaution: true,
        hepaticCaution: true,
        pregnancyCaution: true,
        breastfeedingCaution: true,
        maxDailyDose: true,
        therapeuticClass: true,
        atcCode: true,
        ingredients: { select: { name: true, role: true } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const label = (p: (typeof products)[number]) =>
      `${p.genericName} ${p.strength ?? ''}`.trim();

    // ---- Prescription validity and refills ----
    if (input.prescription) {
      const rx = input.prescription;
      const validityDays = await this.config.getNumber('dispensing.prescriptionValidityDays');
      const expiresAt =
        rx.validUntil ??
        new Date(rx.prescriptionDate.getTime() + validityDays * 86_400_000);

      if (expiresAt.getTime() < Date.now()) {
        const daysOld = Math.floor((Date.now() - expiresAt.getTime()) / 86_400_000);
        warnings.push({
          code: 'PRESCRIPTION_EXPIRED',
          severity: 'CRITICAL',
          productId: '',
          product: 'This prescription',
          message:
            `Expired ${daysOld} day(s) ago (written ${rx.prescriptionDate.toISOString().slice(0, 10)}` +
            `${rx.validUntil ? ', valid until ' + rx.validUntil.toISOString().slice(0, 10) : ''}).`,
          action: 'Contact the prescriber for a current prescription before supplying.',
        });
      }

      if (rx.refillsAllowed > 0 && rx.refillsUsed >= rx.refillsAllowed) {
        warnings.push({
          code: 'NO_REFILLS_REMAINING',
          severity: 'HIGH',
          productId: '',
          product: 'This prescription',
          message: `All ${rx.refillsAllowed} authorised refill(s) have been used.`,
          action: 'A further supply needs a new prescription.',
        });
      }
    }

    // ---- Early refill ----
    //
    // A patient coming back for the same medicine before the last supply could
    // have run out is worth a question. Sometimes the answer is that the bottle
    // was dropped; sometimes it is that the medicine is being sold on. Either
    // way the pharmacist asks, and the reason is recorded — the system does not
    // decide which it is.
    const minRefillDays = await this.config.getNumber('dispensing.minRefillIntervalDays');
    if (minRefillDays > 0 && input.patientId) {
      const since = new Date(Date.now() - minRefillDays * 86_400_000);
      const recent = await this.prisma.dispensing.findMany({
        where: {
          patientId: input.patientId,
          dispensedAt: { gte: since },
          reversedAt: null,
          items: { some: { productId: { in: productIds } } },
        },
        select: {
          dispensedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
        orderBy: { dispensedAt: 'desc' },
      });

      for (const productId of productIds) {
        const last = recent.find((d) => d.items.some((i) => i.productId === productId));
        if (!last) continue;
        const days = Math.floor((Date.now() - last.dispensedAt.getTime()) / 86_400_000);
        const product = byId.get(productId);
        warnings.push({
          code: `EARLY_REFILL:${productId}`,
          severity: 'MEDIUM',
          productId,
          product: product ? label(product) : 'This medicine',
          message:
            `Supplied to this patient ${days} day(s) ago, sooner than the ${minRefillDays}-day ` +
            `interval this pharmacy expects.`,
          action:
            'Ask the patient what happened to the previous supply and record the answer in the ' +
            'counselling note.',
        });
      }
    }

    // ---- Allergy ----
    if (input.patientId) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: input.patientId },
        select: { allergies: true, dateOfBirth: true, sex: true },
      });

      const allergyWords = this.tokenize(patient?.allergies);
      if (allergyWords.size) {
        for (const product of products) {
          const candidates = [
            ...this.tokenize(product.genericName),
            // Excipients are in the list too, and a patient can be allergic to
            // one, so both roles are compared.
            ...product.ingredients.flatMap((i) => [...this.tokenize(i.name)]),
          ];
          const hit = candidates.find((word) => allergyWords.has(word));
          if (hit) {
            warnings.push({
              code: `ALLERGY:${product.id}`,
              severity: 'CRITICAL',
              productId: product.id,
              product: label(product),
              message:
                `The patient's recorded allergies mention "${hit}", which appears in this ` +
                `medicine or its ingredients. The allergy record is free text, so this is a ` +
                `word match and not a clinical determination.`,
              action: 'Check the allergy with the patient before supplying.',
            });
          }
        }
      }

      // A paediatric patient and a product not intended for children.
      if (patient?.dateOfBirth) {
        const years = (Date.now() - patient.dateOfBirth.getTime()) / (365.25 * 86_400_000);
        if (years < 12) {
          for (const product of products.filter((p) => !p.isPediatric)) {
            warnings.push({
              code: `PAEDIATRIC:${product.id}`,
              severity: 'HIGH',
              productId: product.id,
              product: label(product),
              message: `The patient is ${Math.floor(years)}, and this product is not flagged as suitable for children.`,
              action: 'Confirm the dose and the formulation are appropriate for this age.',
            });
          }
        }
      }

      // ---- Duplicate therapy, from what this patient already has ----
      const window = await this.config.getNumber('dispensing.duplicateTherapyWindowDays');
      if (window > 0) {
        const since = new Date(Date.now() - window * 86_400_000);
        const recent = await this.prisma.dispensingItem.findMany({
          where: {
            dispensing: { patientId: input.patientId, dispensedAt: { gte: since }, reversedAt: null },
          },
          select: {
            productId: true,
            dispensing: { select: { dispensingNo: true, dispensedAt: true } },
          },
        });

        const recentIds = [...new Set(recent.map((r) => r.productId))];
        const recentProducts = recentIds.length
          ? await this.prisma.product.findMany({
              where: { id: { in: recentIds } },
              select: { id: true, genericName: true, therapeuticClass: true, atcCode: true },
            })
          : [];

        for (const product of products) {
          const sameProduct = recent.find((r) => r.productId === product.id);
          if (sameProduct) {
            warnings.push({
              code: `DUPLICATE:${product.id}`,
              severity: 'HIGH',
              productId: product.id,
              product: label(product),
              message:
                `Already supplied to this patient on ` +
                `${sameProduct.dispensing.dispensedAt.toISOString().slice(0, 10)} ` +
                `(${sameProduct.dispensing.dispensingNo}).`,
              action: 'Confirm this is a continuation and not a duplicate supply.',
            });
            continue;
          }
          // Same therapeutic class is a weaker signal than the same product,
          // and is reported as such rather than as a duplicate.
          const sameClass = recentProducts.find(
            (r) =>
              r.id !== product.id &&
              product.therapeuticClass &&
              r.therapeuticClass === product.therapeuticClass,
          );
          if (sameClass) {
            warnings.push({
              code: `SAME_CLASS:${product.id}`,
              severity: 'MEDIUM',
              productId: product.id,
              product: label(product),
              message:
                `${sameClass.genericName} — same therapeutic class (${product.therapeuticClass}) — ` +
                `was supplied to this patient recently.`,
              action: 'Check the two are intended together rather than one replacing the other.',
            });
          }
        }
      }
    }

    // ---- Interactions, from the curated product relations ----
    const interactions = await this.prisma.productRelation.findMany({
      where: {
        relationType: 'INTERACTS_WITH',
        OR: [
          { productId: { in: productIds }, relatedProductId: { in: productIds } },
          { relatedProductId: { in: productIds }, productId: { in: productIds } },
        ],
      },
      select: { productId: true, relatedProductId: true, notes: true },
    });
    for (const link of interactions) {
      const a = byId.get(link.productId);
      const b = byId.get(link.relatedProductId);
      if (!a || !b) continue;
      warnings.push({
        code: `INTERACTION:${a.id}:${b.id}`,
        severity: 'CRITICAL',
        productId: a.id,
        product: label(a),
        message: `Recorded interaction with ${label(b)}.${link.notes ? ` ${link.notes}` : ''}`,
        action: 'Review the combination before supplying both.',
      });
    }

    // ---- Dose sanity and per-product cautions ----
    for (const line of input.lines) {
      const product = byId.get(line.productId);
      if (!product) continue;

      const item = input.prescription?.items.find(
        (i) => i.id === line.prescriptionItemId || i.productId === line.productId,
      );
      if (product.maxDailyDose && item?.durationDays && item.durationDays > 0) {
        const perDay = new Prisma.Decimal(line.quantity).dividedBy(item.durationDays);
        if (perDay.greaterThan(product.maxDailyDose)) {
          warnings.push({
            code: `MAX_DAILY_DOSE:${product.id}`,
            severity: 'CRITICAL',
            productId: product.id,
            product: label(product),
            message:
              `${line.quantity} ${product.baseUnit} over ${item.durationDays} day(s) is ` +
              `${perDay.toFixed(2)} per day, above the recorded maximum of ` +
              `${product.maxDailyDose.toString()}.`,
            action: 'Check the regimen with the prescriber before supplying.',
          });
        }
      }

      for (const [flag, code, text] of [
        [product.renalCaution, 'RENAL', 'Caution in renal impairment.'],
        [product.hepaticCaution, 'HEPATIC', 'Caution in hepatic impairment.'],
        [product.pregnancyCaution, 'PREGNANCY', 'Caution in pregnancy.'],
        [product.breastfeedingCaution, 'BREASTFEEDING', 'Caution while breastfeeding.'],
      ] as Array<[boolean, string, string]>) {
        if (!flag) continue;
        warnings.push({
          code: `${code}:${product.id}`,
          severity: 'MEDIUM',
          productId: product.id,
          product: label(product),
          message: text,
          action: 'Confirm the caution does not apply to this patient.',
        });
      }

      if (product.isLookAlikeSoundAlike) {
        warnings.push({
          code: `LASA:${product.id}`,
          severity: 'MEDIUM',
          productId: product.id,
          product: label(product),
          message: 'This medicine looks or sounds like another one.',
          action: 'Read the label back against the prescription before handing it over.',
        });
      }

      if (product.isColdChain) {
        warnings.push({
          code: `COLD_CHAIN:${product.id}`,
          severity: 'LOW',
          productId: product.id,
          product: label(product),
          message: 'Cold-chain product.',
          action: 'Supply in a cold bag and tell the patient how to store it.',
        });
      }
    }

    const order: Record<WarningSeverity, number> = {
      CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
    };
    return warnings.sort((a, b) => order[a.severity] - order[b.severity]);
  }
}
