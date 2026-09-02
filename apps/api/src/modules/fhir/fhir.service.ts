import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ConfigService } from '../../common/config/config.service';
import { AuthenticatedUser } from '../../common/decorators';
import {
  FhirIssue,
  SUPPORTED_FHIR_VERSION,
  fromFhirMedicationRequest,
  fromFhirPatient,
  operationOutcome,
  toBundle,
  toFhirMedication,
  toFhirMedicationDispenses,
  toFhirMedicationRequests,
  toFhirOrganization,
  toFhirPatient,
  toFhirPractitioner,
} from './fhir.mapper';

/**
 * The FHIR integration boundary (§54).
 *
 * Everything crossing it is logged with the payload, the mapping outcome and
 * the issues found, because an interoperability problem is always a question of
 * what was actually sent or received. Inbound writes are idempotent on a
 * caller-supplied key, so a partner retrying a timed-out request cannot create
 * the record twice.
 */
@Injectable()
export class FhirService {
  private readonly logger = new Logger(FhirService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private async assertEnabled(): Promise<void> {
    if (!(await this.config.isEnabled('feature.fhir'))) {
      throw new BadRequestException('The FHIR interoperability layer is disabled for this organization');
    }
  }

  private async log(entry: {
    direction: 'INBOUND' | 'OUTBOUND';
    resourceType: string;
    status: string;
    operation?: string;
    externalId?: string | null;
    internalId?: string | null;
    issues?: FhirIssue[];
    requestBody?: unknown;
    responseBody?: unknown;
    idempotencyKey?: string | null;
    errorMessage?: string;
    durationMs?: number;
    userId?: string;
  }) {
    try {
      await this.prisma.fhirExchange.create({
        data: {
          direction: entry.direction,
          resourceType: entry.resourceType,
          operation: entry.operation ?? null,
          status: entry.status,
          externalId: entry.externalId ?? null,
          internalId: entry.internalId ?? null,
          fhirVersion: SUPPORTED_FHIR_VERSION,
          issues: (entry.issues ?? []) as unknown as Prisma.InputJsonValue,
          // Payloads are stored so an exchange can be replayed and explained.
          requestBody: (entry.requestBody ?? null) as Prisma.InputJsonValue,
          responseBody: (entry.responseBody ?? null) as Prisma.InputJsonValue,
          idempotencyKey: entry.idempotencyKey ?? null,
          errorMessage: entry.errorMessage ?? null,
          durationMs: entry.durationMs ?? null,
          userId: entry.userId ?? null,
        },
      });
    } catch (error) {
      // A logging failure must never fail the exchange it describes.
      this.logger.warn(`Could not record FHIR exchange: ${(error as Error).message}`);
    }
  }

  // ---- Outbound reads ----

  async capability() {
    const enabled = await this.config.isEnabled('feature.fhir');
    return {
      resourceType: 'CapabilityStatement',
      status: enabled ? 'active' : 'retired',
      date: new Date().toISOString(),
      publisher: 'PharmaCore',
      kind: 'instance',
      fhirVersion: SUPPORTED_FHIR_VERSION,
      format: ['application/fhir+json'],
      rest: [
        {
          mode: 'server',
          security: {
            description:
              'Bearer session token, or an API key in the X-Api-Key header. Every request is authorised by the same permissions a person would need.',
          },
          resource: [
            { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }] },
            { type: 'Practitioner', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            { type: 'Organization', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            { type: 'Medication', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            {
              type: 'MedicationRequest',
              interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }],
            },
            { type: 'MedicationDispense', interaction: [{ code: 'read' }, { code: 'search-type' }] },
          ],
        },
      ],
    };
  }

  async readPatient(id: string, user: AuthenticatedUser) {
    await this.assertEnabled();
    const started = Date.now();

    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient) {
      await this.log({
        direction: 'OUTBOUND',
        resourceType: 'Patient',
        operation: 'read',
        status: 'REJECTED',
        externalId: id,
        errorMessage: 'Not found',
        userId: user.id,
      });
      throw new NotFoundException('Patient not found');
    }

    const resource = toFhirPatient(patient);
    await this.log({
      direction: 'OUTBOUND',
      resourceType: 'Patient',
      operation: 'read',
      status: 'ACCEPTED',
      internalId: id,
      responseBody: resource,
      durationMs: Date.now() - started,
      userId: user.id,
    });
    return resource;
  }

  async searchPatients(query: { name?: string; identifier?: string; phone?: string; _count?: number }) {
    await this.assertEnabled();
    const take = Math.min(Number(query._count ?? 50), 200);

    const patients = await this.prisma.patient.findMany({
      where: {
        ...(query.name ? { fullName: { contains: query.name, mode: 'insensitive' } } : {}),
        ...(query.identifier ? { patientCode: query.identifier } : {}),
        ...(query.phone ? { phone: { contains: query.phone } } : {}),
      },
      take,
      orderBy: { fullName: 'asc' },
    });

    return toBundle(patients.map(toFhirPatient));
  }

  async readMedication(id: string) {
    await this.assertEnabled();
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        manufacturer: { select: { name: true } },
        ingredients: { where: { role: 'ACTIVE' }, orderBy: { sequence: 'asc' } },
      },
    });
    if (!product) throw new NotFoundException('Medication not found');

    return toFhirMedication({
      ...product,
      manufacturerName: product.manufacturer?.name ?? null,
      ingredients: product.ingredients.map((i) => ({
        name: i.name,
        strengthValue: i.strengthValue?.toString() ?? null,
        strengthUnit: i.strengthUnit,
      })),
    });
  }

  async searchMedications(query: { name?: string; code?: string; identifier?: string; _count?: number }) {
    await this.assertEnabled();
    const take = Math.min(Number(query._count ?? 50), 200);

    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(query.code ? { atcCode: query.code } : {}),
        ...(query.identifier ? { OR: [{ sku: query.identifier }, { gtin: query.identifier }] } : {}),
        ...(query.name
          ? {
              OR: [
                { genericName: { contains: query.name, mode: 'insensitive' } },
                { brandName: { contains: query.name, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { ingredients: { where: { role: 'ACTIVE' }, orderBy: { sequence: 'asc' } } },
      take,
    });

    return toBundle(
      products.map((p) =>
        toFhirMedication({
          ...p,
          ingredients: p.ingredients.map((i) => ({
            name: i.name,
            strengthValue: i.strengthValue?.toString() ?? null,
            strengthUnit: i.strengthUnit,
          })),
        }),
      ),
    );
  }

  async readMedicationRequest(prescriptionId: string) {
    await this.assertEnabled();
    const prescription = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: { items: true },
    });
    if (!prescription) throw new NotFoundException('Prescription not found');

    const productIds = prescription.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, genericName: true, strength: true },
    });
    const byProduct = new Map(products.map((p) => [p.id, p]));

    return toBundle(
      toFhirMedicationRequests({
        id: prescription.id,
        prescriptionNo: prescription.prescriptionNo,
        status: prescription.status,
        prescribedAt: prescription.prescriptionDate,
        expiresAt: null,
        patientId: prescription.patientId,
        prescriberName: prescription.prescriberName,
        prescriberLicence: prescription.prescriberLicense,
        notes: null,
        items: prescription.items.map((i) => {
          const product = byProduct.get(i.productId);
          return {
            id: i.id,
            productId: i.productId,
            productName: product ? `${product.genericName} ${product.strength}` : 'Unknown',
            quantityPrescribed: i.prescribedQty.toString(),
            dosageInstructions: i.instructions ?? i.dosage,
            frequency: i.frequency,
            durationDays: i.durationDays,
            refillsAllowed: prescription.refillsAllowed,
          };
        }),
      }),
    );
  }

  async readMedicationDispense(dispensingId: string) {
    await this.assertEnabled();
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id: dispensingId },
      include: { items: true, prescription: { select: { prescriptionNo: true } } },
    });
    if (!dispensing) throw new NotFoundException('Dispensing not found');

    const [products, batches, pharmacist] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: dispensing.items.map((i) => i.productId) } },
        select: { id: true, genericName: true, strength: true },
      }),
      this.prisma.batch.findMany({
        where: { id: { in: dispensing.items.map((i) => i.batchId) } },
        select: { id: true, batchNumber: true, expiryDate: true },
      }),
      this.prisma.user.findUnique({
        where: { id: dispensing.pharmacistId },
        select: { fullName: true },
      }),
    ]);
    const byProduct = new Map(products.map((p) => [p.id, p]));
    const byBatch = new Map(batches.map((b) => [b.id, b]));

    return toBundle(
      toFhirMedicationDispenses({
        id: dispensing.id,
        dispensingNo: dispensing.dispensingNo,
        dispensedAt: dispensing.dispensedAt,
        patientId: dispensing.patientId,
        prescriptionId: dispensing.prescriptionId,
        prescriptionNo: dispensing.prescription?.prescriptionNo ?? null,
        branchId: dispensing.branchId,
        pharmacistName: pharmacist?.fullName ?? null,
        items: dispensing.items.map((i) => {
          const product = byProduct.get(i.productId);
          const batch = byBatch.get(i.batchId);
          return {
            id: i.id,
            productId: i.productId,
            productName: product ? `${product.genericName} ${product.strength}` : 'Unknown',
            batchNumber: batch?.batchNumber ?? null,
            expiryDate: batch?.expiryDate ?? null,
            quantity: i.quantity.toString(),
            instructions: null,
          };
        }),
      }),
    );
  }

  async searchOrganizations() {
    await this.assertEnabled();
    const branches = await this.prisma.branch.findMany({ orderBy: { name: 'asc' } });
    return toBundle(branches.map(toFhirOrganization));
  }

  async searchPractitioners(query: { name?: string; _count?: number }) {
    await this.assertEnabled();
    // Prescribers are recorded on prescriptions rather than as users, so the
    // Practitioner resource is served from the licensed staff who dispense.
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        licenseNumber: { not: null },
        ...(query.name ? { fullName: { contains: query.name, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        fullName: true,
        licenseNumber: true,
        phone: true,
        email: true,
        status: true,
      },
      take: Math.min(Number(query._count ?? 50), 200),
    });

    return toBundle(
      users.map((u) =>
        toFhirPractitioner({
          id: u.id,
          fullName: u.fullName,
          licenseNumber: u.licenseNumber,
          phone: u.phone,
          email: u.email,
          isActive: u.status === 'ACTIVE',
        }),
      ),
    );
  }

  // ---- Inbound writes ----

  /**
   * Accept a Patient from an external system.
   *
   * Matched on the PharmaCore patient code when one is supplied, so a second
   * send updates rather than duplicating.
   */
  async ingestPatient(
    resource: Record<string, unknown>,
    context: { idempotencyKey?: string; user: AuthenticatedUser },
  ) {
    await this.assertEnabled();
    const started = Date.now();

    if (context.idempotencyKey) {
      const seen = await this.prisma.fhirExchange.findUnique({
        where: { idempotencyKey: context.idempotencyKey },
      });
      if (seen) {
        // A partner retrying a timed-out request gets the original result back
        // rather than a second patient record.
        return {
          duplicate: true,
          status: seen.status,
          internalId: seen.internalId,
          resource: seen.responseBody,
        };
      }
    }

    const mapped = fromFhirPatient(resource as Record<string, any>);

    if (!mapped.valid || !mapped.value) {
      await this.log({
        direction: 'INBOUND',
        resourceType: 'Patient',
        operation: 'create',
        status: 'REJECTED',
        issues: mapped.issues,
        requestBody: resource,
        idempotencyKey: context.idempotencyKey ?? null,
        durationMs: Date.now() - started,
        userId: context.user.id,
      });
      throw new BadRequestException(operationOutcome(mapped.issues));
    }

    const input = mapped.value;

    const existing = input.patientCode
      ? await this.prisma.patient.findUnique({ where: { patientCode: input.patientCode } })
      : null;

    const patient = existing
      ? await this.prisma.patient.update({
          where: { id: existing.id },
          data: {
            fullName: input.fullName,
            dateOfBirth: input.dateOfBirth,
            sex: input.sex,
            phone: input.phone,
            email: input.email,
            addressLine: input.addressLine,
            city: input.city,
            preferredLanguage: input.preferredLanguage,
          },
        })
      : await this.prisma.patient.create({
          data: {
            patientCode:
              input.patientCode ?? `FHIR-${Date.now().toString(36).toUpperCase()}`,
            fullName: input.fullName,
            dateOfBirth: input.dateOfBirth,
            sex: input.sex,
            phone: input.phone,
            email: input.email,
            addressLine: input.addressLine,
            city: input.city,
            preferredLanguage: input.preferredLanguage,
          },
        });

    const response = toFhirPatient(patient);

    await this.log({
      direction: 'INBOUND',
      resourceType: 'Patient',
      operation: existing ? 'update' : 'create',
      status: 'ACCEPTED',
      externalId: input.externalId,
      internalId: patient.id,
      issues: mapped.issues,
      requestBody: resource,
      responseBody: response,
      idempotencyKey: context.idempotencyKey ?? null,
      durationMs: Date.now() - started,
      userId: context.user.id,
    });

    await this.audit.record({
      userId: context.user.id,
      module: 'sales',
      action: existing ? 'EDIT' : 'CREATE',
      entityType: 'Patient',
      entityId: patient.id,
      newValue: { source: 'FHIR', externalId: input.externalId },
    });

    return {
      duplicate: false,
      created: !existing,
      internalId: patient.id,
      // Warnings are returned even on success: a patient with no contact detail
      // was still accepted, and the sender should know.
      warnings: mapped.issues.filter((i) => i.severity === 'warning'),
      resource: response,
    };
  }

  /**
   * Accept a MedicationRequest as an electronic prescription.
   *
   * Registered as a prescription awaiting pharmacist review — never as an
   * approved one. §24 is explicit that a pharmacist validates before anything
   * is dispensed, and an external system cannot bypass that.
   */
  async ingestMedicationRequest(
    resource: Record<string, unknown>,
    context: { idempotencyKey?: string; user: AuthenticatedUser; branchId?: string },
  ) {
    await this.assertEnabled();
    const started = Date.now();

    if (context.idempotencyKey) {
      const seen = await this.prisma.fhirExchange.findUnique({
        where: { idempotencyKey: context.idempotencyKey },
      });
      if (seen) {
        return { duplicate: true, status: seen.status, internalId: seen.internalId };
      }
    }

    const mapped = fromFhirMedicationRequest(resource as Record<string, any>);
    if (!mapped.valid || !mapped.value) {
      await this.log({
        direction: 'INBOUND',
        resourceType: 'MedicationRequest',
        operation: 'create',
        status: 'REJECTED',
        issues: mapped.issues,
        requestBody: resource,
        idempotencyKey: context.idempotencyKey ?? null,
        durationMs: Date.now() - started,
        userId: context.user.id,
      });
      throw new BadRequestException(operationOutcome(mapped.issues));
    }

    const input = mapped.value;
    const issues = [...mapped.issues];

    // Resolve the patient. An unknown patient is a rejection, not a silent
    // creation: a prescription for somebody the pharmacy has never seen needs a
    // human to reconcile it.
    const patient = input.patientIdentifier
      ? await this.prisma.patient.findUnique({ where: { patientCode: input.patientIdentifier } })
      : input.patientReference
        ? await this.prisma.patient.findUnique({ where: { id: input.patientReference } })
        : null;

    if (!patient) {
      issues.push({
        severity: 'error',
        path: 'subject',
        message:
          'The patient could not be matched. Send the Patient resource first, or use the PharmaCore patient code.',
      });
    }

    // Resolve the medicine, by internal id, GTIN/SKU, or ATC code.
    const product = input.medicationReference
      ? await this.prisma.product.findUnique({ where: { id: input.medicationReference } })
      : input.medicationIdentifier
        ? await this.prisma.product.findFirst({
            where: {
              OR: [
                { sku: input.medicationIdentifier },
                { gtin: input.medicationIdentifier },
                { atcCode: input.medicationIdentifier },
              ],
            },
          })
        : null;

    if (!product) {
      issues.push({
        severity: 'error',
        path: 'medication',
        message: `Could not match '${
          input.medicationText ?? input.medicationIdentifier ?? input.medicationReference
        }' to a product. Map it in the drug master first.`,
      });
    }

    if (issues.some((i) => i.severity === 'error')) {
      await this.log({
        direction: 'INBOUND',
        resourceType: 'MedicationRequest',
        operation: 'create',
        status: 'REJECTED',
        issues,
        requestBody: resource,
        idempotencyKey: context.idempotencyKey ?? null,
        durationMs: Date.now() - started,
        userId: context.user.id,
      });
      throw new BadRequestException(operationOutcome(issues));
    }

    const branchId =
      context.branchId ??
      context.user.branchIds[0] ??
      (await this.prisma.branch.findFirstOrThrow({ select: { id: true } })).id;

    const prescription = await this.prisma.$transaction(async (tx) => {
      const prefix = `RX-${new Date().getFullYear()}-`;
      await this.prisma.advisoryLock(tx, `docnum:RX:${new Date().getFullYear()}`);
      const last = await tx.prescription.findFirst({
        where: { prescriptionNo: { startsWith: prefix } },
        orderBy: { prescriptionNo: 'desc' },
        select: { prescriptionNo: true },
      });
      const next = last ? Number(last.prescriptionNo.slice(prefix.length)) + 1 : 1;

      return tx.prescription.create({
        data: {
          prescriptionNo: `${prefix}${String(next).padStart(6, '0')}`,
          patientId: patient!.id,
          branchId,
          prescriberName: input.prescriberName ?? 'External prescriber',
          prescriberLicense: input.prescriberLicence,
          prescriptionDate: input.authoredOn,
          // Never APPROVED on arrival: a pharmacist reviews it first (§24).
          status: 'NEW',
          refillsAllowed: input.refills,
          items: {
            create: [
              {
                productId: product!.id,
                prescribedQty: new Prisma.Decimal(input.quantity ?? 0),
                instructions: input.dosageText,
                durationDays: input.durationDays,
              },
            ],
          },
        },
        include: { items: true },
      });
    });

    await this.log({
      direction: 'INBOUND',
      resourceType: 'MedicationRequest',
      operation: 'create',
      status: 'ACCEPTED',
      externalId: input.externalId,
      internalId: prescription.id,
      issues,
      requestBody: resource,
      responseBody: { prescriptionNo: prescription.prescriptionNo, status: prescription.status },
      idempotencyKey: context.idempotencyKey ?? null,
      durationMs: Date.now() - started,
      userId: context.user.id,
    });

    await this.audit.record({
      userId: context.user.id,
      module: 'dispensing',
      action: 'CREATE',
      entityType: 'Prescription',
      entityId: prescription.id,
      newValue: { source: 'FHIR', prescriptionNo: prescription.prescriptionNo },
    });

    return {
      duplicate: false,
      internalId: prescription.id,
      prescriptionNo: prescription.prescriptionNo,
      status: prescription.status,
      note: 'Registered for pharmacist review. Nothing is dispensed until a pharmacist validates it.',
      warnings: issues.filter((i) => i.severity === 'warning'),
    };
  }

  // ---- Exchange log ----

  async exchanges(filter: {
    direction?: string;
    resourceType?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, filter.pageSize ?? 50);

    const where: Prisma.FhirExchangeWhereInput = {
      ...(filter.direction ? { direction: filter.direction } : {}),
      ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.fhirExchange.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.fhirExchange.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /** Failure rates by resource, for the integration health screen. */
  async health() {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const grouped = await this.prisma.fhirExchange.groupBy({
      by: ['resourceType', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    const byResource = new Map<string, { accepted: number; rejected: number; failed: number }>();
    for (const row of grouped) {
      const entry = byResource.get(row.resourceType) ?? { accepted: 0, rejected: 0, failed: 0 };
      if (row.status === 'ACCEPTED') entry.accepted += row._count._all;
      else if (row.status === 'REJECTED') entry.rejected += row._count._all;
      else entry.failed += row._count._all;
      byResource.set(row.resourceType, entry);
    }

    return {
      fhirVersion: SUPPORTED_FHIR_VERSION,
      windowDays: 7,
      resources: [...byResource.entries()].map(([resourceType, counts]) => ({
        resourceType,
        ...counts,
        total: counts.accepted + counts.rejected + counts.failed,
        rejectionRate:
          counts.accepted + counts.rejected + counts.failed > 0
            ? Math.round(
                ((counts.rejected + counts.failed) /
                  (counts.accepted + counts.rejected + counts.failed)) *
                  100,
              )
            : 0,
      })),
    };
  }
}
