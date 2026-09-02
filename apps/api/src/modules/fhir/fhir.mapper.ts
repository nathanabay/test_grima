/**
 * FHIR mapping (§54).
 *
 * A pure translation layer between PharmaCore records and HL7 FHIR R4
 * resources. It is deliberately separate from the domain services: core
 * inventory tables must never take their shape from an external payload
 * format, and a change to FHIR must never require a migration.
 *
 * Nothing clinical is invented here. A field with no source in PharmaCore is
 * omitted rather than guessed — an absent `dosageInstruction` is honest, an
 * invented one is dangerous.
 */

export const SUPPORTED_FHIR_VERSION = '4.0.1';

export interface FhirIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  issues: FhirIssue[];
  value?: T;
}

/** A FHIR OperationOutcome, which is what a FHIR client expects on failure. */
export function operationOutcome(issues: FhirIssue[]) {
  return {
    resourceType: 'OperationOutcome',
    issue: issues.map((i) => ({
      severity: i.severity,
      code: i.severity === 'error' ? 'invalid' : 'informational',
      diagnostics: i.message,
      expression: [i.path],
    })),
  };
}

/** A FHIR Reference, or undefined when there is nothing to point at. */
function reference(resourceType: string, id: string | null | undefined) {
  return id ? { reference: `${resourceType}/${id}` } : undefined;
}

/** Strip keys whose value is undefined, so a resource carries no empty fields. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as T;
}

// ---------------------------------------------------------------------------
// Outbound: PharmaCore -> FHIR
// ---------------------------------------------------------------------------

export interface PatientRecord {
  id: string;
  patientCode: string;
  fullName: string;
  dateOfBirth: Date | null;
  sex: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  isActive: boolean;
  preferredLanguage: string | null;
}

export function toFhirPatient(patient: PatientRecord) {
  // FHIR wants name parts. PharmaCore stores one full name because Ethiopian
  // names do not split into family/given the way the resource assumes, so the
  // whole name is sent as `text` with the parts left out rather than guessed.
  const parts = patient.fullName.trim().split(/\s+/);

  return compact({
    resourceType: 'Patient',
    id: patient.id,
    identifier: [
      {
        system: 'urn:pharmacore:patient-code',
        value: patient.patientCode,
      },
    ],
    active: patient.isActive,
    name: [
      compact({
        use: 'official',
        text: patient.fullName,
        given: parts.length > 1 ? parts.slice(0, -1) : undefined,
        family: parts.length > 1 ? parts[parts.length - 1] : undefined,
      }),
    ],
    telecom: [
      patient.phone ? { system: 'phone', value: patient.phone, use: 'mobile' } : undefined,
      patient.email ? { system: 'email', value: patient.email } : undefined,
    ].filter(Boolean),
    gender:
      patient.sex === 'M' ? 'male' : patient.sex === 'F' ? 'female' : undefined,
    birthDate: patient.dateOfBirth ? patient.dateOfBirth.toISOString().slice(0, 10) : undefined,
    address:
      patient.addressLine || patient.city
        ? [compact({ line: patient.addressLine ? [patient.addressLine] : undefined, city: patient.city ?? undefined })]
        : undefined,
    communication: patient.preferredLanguage
      ? [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: patient.preferredLanguage }] } }]
      : undefined,
  });
}

export interface PractitionerRecord {
  id: string;
  fullName: string;
  licenseNumber: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

export function toFhirPractitioner(practitioner: PractitionerRecord) {
  const parts = practitioner.fullName.trim().split(/\s+/);
  return compact({
    resourceType: 'Practitioner',
    id: practitioner.id,
    identifier: practitioner.licenseNumber
      ? [{ system: 'urn:pharmacore:practitioner-licence', value: practitioner.licenseNumber }]
      : undefined,
    active: practitioner.isActive,
    name: [
      compact({
        text: practitioner.fullName,
        given: parts.length > 1 ? parts.slice(0, -1) : undefined,
        family: parts.length > 1 ? parts[parts.length - 1] : undefined,
      }),
    ],
    telecom: [
      practitioner.phone ? { system: 'phone', value: practitioner.phone } : undefined,
      practitioner.email ? { system: 'email', value: practitioner.email } : undefined,
    ].filter(Boolean),
  });
}

export interface OrganizationRecord {
  id: string;
  code: string;
  name: string;
  branchType?: string;
  licenseNumber: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  isActive: boolean;
}

export function toFhirOrganization(org: OrganizationRecord) {
  return compact({
    resourceType: 'Organization',
    id: org.id,
    identifier: [
      { system: 'urn:pharmacore:branch-code', value: org.code },
      ...(org.licenseNumber
        ? [{ system: 'urn:pharmacore:licence', value: org.licenseNumber }]
        : []),
    ],
    active: org.isActive,
    type: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/organization-type',
            code: 'prov',
            display: 'Healthcare Provider',
          },
        ],
        text: org.branchType,
      },
    ],
    name: org.name,
    telecom: [
      org.phone ? { system: 'phone', value: org.phone } : undefined,
      org.email ? { system: 'email', value: org.email } : undefined,
    ].filter(Boolean),
    address:
      org.addressLine || org.city
        ? [compact({ line: org.addressLine ? [org.addressLine] : undefined, city: org.city ?? undefined })]
        : undefined,
  });
}

export interface MedicationRecord {
  id: string;
  sku: string;
  gtin: string | null;
  genericName: string;
  brandName: string | null;
  strength: string;
  dosageForm: string;
  atcCode: string | null;
  isActive: boolean;
  manufacturerName?: string | null;
  ingredients?: { name: string; strengthValue: string | null; strengthUnit: string | null }[];
}

export function toFhirMedication(medication: MedicationRecord) {
  return compact({
    resourceType: 'Medication',
    id: medication.id,
    identifier: [
      { system: 'urn:pharmacore:sku', value: medication.sku },
      ...(medication.gtin ? [{ system: 'urn:gs1:gtin', value: medication.gtin }] : []),
    ],
    code: {
      coding: [
        // ATC is the only external code system PharmaCore actually holds.
        // RxNorm or SNOMED would have to be mapped by the receiving system.
        ...(medication.atcCode
          ? [
              {
                system: 'http://www.whocc.no/atc',
                code: medication.atcCode,
                display: medication.genericName,
              },
            ]
          : []),
      ],
      text: `${medication.brandName ? `${medication.brandName} (${medication.genericName})` : medication.genericName} ${medication.strength}`,
    },
    status: medication.isActive ? 'active' : 'inactive',
    // R4 names these `form` and `itemCodeableConcept`; the R5 spellings
    // (`doseForm`, `item`) would not validate against the version advertised
    // in the CapabilityStatement.
    form: { text: medication.dosageForm },
    ingredient: medication.ingredients?.length
      ? medication.ingredients.map((i) =>
          compact({
            itemCodeableConcept: { text: i.name },
            isActive: true,
            strength:
              i.strengthValue && i.strengthUnit
                ? {
                    numerator: { value: Number(i.strengthValue), unit: i.strengthUnit },
                    denominator: { value: 1 },
                  }
                : undefined,
          }),
        )
      : undefined,
  });
}

export interface MedicationRequestRecord {
  id: string;
  prescriptionNo: string;
  status: string;
  prescribedAt: Date;
  expiresAt: Date | null;
  patientId: string;
  prescriberName: string | null;
  prescriberLicence: string | null;
  notes: string | null;
  items: {
    id: string;
    productId: string;
    productName: string;
    quantityPrescribed: string;
    dosageInstructions: string | null;
    frequency: string | null;
    durationDays: number | null;
    refillsAllowed: number;
  }[];
}

/** PharmaCore prescription statuses mapped onto the FHIR value set. */
const REQUEST_STATUS: Record<string, string> = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'draft',
  APPROVED: 'active',
  PARTIALLY_DISPENSED: 'active',
  DISPENSED: 'completed',
  COMPLETED: 'completed',
  REJECTED: 'cancelled',
  CANCELLED: 'cancelled',
  EXPIRED: 'stopped',
};

export function toFhirMedicationRequests(request: MedicationRequestRecord) {
  // FHIR models one medication per MedicationRequest, while a PharmaCore
  // prescription carries several lines. One resource per line, grouped by the
  // prescription's identifier so the original document is recoverable.
  return request.items.map((item) =>
    compact({
      resourceType: 'MedicationRequest',
      id: `${request.id}:${item.id}`,
      identifier: [{ system: 'urn:pharmacore:prescription', value: request.prescriptionNo }],
      status: REQUEST_STATUS[request.status] ?? 'unknown',
      intent: 'order',
      medicationReference: compact({
        reference: `Medication/${item.productId}`,
        display: item.productName,
      }),
      subject: reference('Patient', request.patientId),
      authoredOn: request.prescribedAt.toISOString(),
      requester: request.prescriberName
        ? compact({
            display: request.prescriberName,
            identifier: request.prescriberLicence
              ? { system: 'urn:pharmacore:practitioner-licence', value: request.prescriberLicence }
              : undefined,
          })
        : undefined,
      // Only what was actually recorded. An absent instruction is left absent.
      dosageInstruction: item.dosageInstructions
        ? [
            compact({
              text: item.dosageInstructions,
              timing: item.frequency ? { code: { text: item.frequency } } : undefined,
            }),
          ]
        : undefined,
      dispenseRequest: compact({
        quantity: { value: Number(item.quantityPrescribed) },
        numberOfRepeatsAllowed: item.refillsAllowed || undefined,
        expectedSupplyDuration: item.durationDays
          ? { value: item.durationDays, unit: 'd', system: 'http://unitsofmeasure.org', code: 'd' }
          : undefined,
        validityPeriod: request.expiresAt
          ? { start: request.prescribedAt.toISOString(), end: request.expiresAt.toISOString() }
          : undefined,
      }),
      note: request.notes ? [{ text: request.notes }] : undefined,
    }),
  );
}

export interface MedicationDispenseRecord {
  id: string;
  dispensingNo: string;
  dispensedAt: Date;
  patientId: string | null;
  prescriptionId: string | null;
  prescriptionNo: string | null;
  branchId: string;
  pharmacistName: string | null;
  items: {
    id: string;
    productId: string;
    productName: string;
    batchNumber: string | null;
    expiryDate: Date | null;
    quantity: string;
    instructions: string | null;
  }[];
}

export function toFhirMedicationDispenses(dispense: MedicationDispenseRecord) {
  return dispense.items.map((item) =>
    compact({
      resourceType: 'MedicationDispense',
      id: `${dispense.id}:${item.id}`,
      identifier: [{ system: 'urn:pharmacore:dispensing', value: dispense.dispensingNo }],
      status: 'completed',
      medicationReference: compact({
        reference: `Medication/${item.productId}`,
        display: item.productName,
      }),
      subject: reference('Patient', dispense.patientId),
      // The batch and expiry actually handed over: the single most useful thing
      // a receiving system can have for a recall.
      ...(item.batchNumber
        ? {
            extension: [
              {
                url: 'urn:pharmacore:batch',
                valueString: item.batchNumber,
              },
              ...(item.expiryDate
                ? [{ url: 'urn:pharmacore:expiry', valueDate: item.expiryDate.toISOString().slice(0, 10) }]
                : []),
            ],
          }
        : {}),
      performer: dispense.pharmacistName
        ? [{ actor: { display: dispense.pharmacistName } }]
        : undefined,
      location: reference('Organization', dispense.branchId),
      authorizingPrescription: dispense.prescriptionId
        ? [{ identifier: { system: 'urn:pharmacore:prescription', value: dispense.prescriptionNo ?? '' } }]
        : undefined,
      quantity: { value: Number(item.quantity) },
      whenHandedOver: dispense.dispensedAt.toISOString(),
      dosageInstruction: item.instructions ? [{ text: item.instructions }] : undefined,
    }),
  );
}

/** Wrap resources in a FHIR searchset Bundle. */
export function toBundle(resources: unknown[], total?: number) {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: total ?? resources.length,
    entry: resources.map((resource) => ({ resource })),
  };
}

// ---------------------------------------------------------------------------
// Inbound: FHIR -> PharmaCore
// ---------------------------------------------------------------------------

export interface InboundPatient {
  externalId: string | null;
  patientCode: string | null;
  fullName: string;
  dateOfBirth: Date | null;
  sex: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  preferredLanguage: string | null;
}

/**
 * Validate and map an incoming Patient.
 *
 * Validation is strict about identity and permissive about everything else: a
 * record with no usable name cannot be created, but a missing address is only
 * a warning.
 */
export function fromFhirPatient(resource: Record<string, any>): ValidationResult<InboundPatient> {
  const issues: FhirIssue[] = [];

  if (resource?.resourceType !== 'Patient') {
    issues.push({
      severity: 'error',
      path: 'resourceType',
      message: `Expected a Patient resource, received '${resource?.resourceType ?? 'nothing'}'`,
    });
    return { valid: false, issues };
  }

  const name = Array.isArray(resource.name) ? resource.name[0] : undefined;
  const fullName =
    name?.text ??
    [...(name?.given ?? []), name?.family].filter(Boolean).join(' ').trim();

  if (!fullName) {
    issues.push({
      severity: 'error',
      path: 'name',
      message: 'A patient must carry a name, either as name[0].text or as given and family parts',
    });
  }

  let dateOfBirth: Date | null = null;
  if (resource.birthDate) {
    const parsed = new Date(resource.birthDate);
    if (Number.isNaN(parsed.getTime())) {
      issues.push({ severity: 'error', path: 'birthDate', message: `'${resource.birthDate}' is not a valid date` });
    } else if (parsed.getTime() > Date.now()) {
      issues.push({ severity: 'error', path: 'birthDate', message: 'A date of birth cannot be in the future' });
    } else {
      dateOfBirth = parsed;
    }
  }

  const gender = resource.gender;
  if (gender && !['male', 'female', 'other', 'unknown'].includes(gender)) {
    issues.push({
      severity: 'error',
      path: 'gender',
      message: `'${gender}' is not a FHIR administrative gender`,
    });
  }

  const telecom: { system?: string; value?: string }[] = resource.telecom ?? [];
  const phone = telecom.find((t) => t.system === 'phone')?.value ?? null;
  const email = telecom.find((t) => t.system === 'email')?.value ?? null;

  if (!phone && !email) {
    issues.push({
      severity: 'warning',
      path: 'telecom',
      message: 'No phone or email: the patient cannot be contacted for a recall or a refill',
    });
  }

  const address = Array.isArray(resource.address) ? resource.address[0] : undefined;
  const identifiers: { system?: string; value?: string }[] = resource.identifier ?? [];

  if (issues.some((i) => i.severity === 'error')) return { valid: false, issues };

  return {
    valid: true,
    issues,
    value: {
      externalId: resource.id ?? null,
      patientCode:
        identifiers.find((i) => i.system === 'urn:pharmacore:patient-code')?.value ?? null,
      fullName,
      dateOfBirth,
      sex: gender === 'male' ? 'M' : gender === 'female' ? 'F' : null,
      phone,
      email,
      addressLine: Array.isArray(address?.line) ? address.line.join(', ') : null,
      city: address?.city ?? null,
      preferredLanguage:
        resource.communication?.[0]?.language?.coding?.[0]?.code ?? null,
    },
  };
}

export interface InboundMedicationRequest {
  externalId: string | null;
  prescriptionNo: string | null;
  patientReference: string | null;
  patientIdentifier: string | null;
  prescriberName: string | null;
  prescriberLicence: string | null;
  authoredOn: Date;
  validUntil: Date | null;
  medicationReference: string | null;
  medicationIdentifier: string | null;
  medicationText: string | null;
  quantity: number | null;
  refills: number;
  dosageText: string | null;
  durationDays: number | null;
  status: string;
}

export function fromFhirMedicationRequest(
  resource: Record<string, any>,
): ValidationResult<InboundMedicationRequest> {
  const issues: FhirIssue[] = [];

  if (resource?.resourceType !== 'MedicationRequest') {
    issues.push({
      severity: 'error',
      path: 'resourceType',
      message: `Expected a MedicationRequest, received '${resource?.resourceType ?? 'nothing'}'`,
    });
    return { valid: false, issues };
  }

  if (resource.intent && resource.intent !== 'order' && resource.intent !== 'original-order') {
    issues.push({
      severity: 'error',
      path: 'intent',
      message: `Only an order can be dispensed against; this is a '${resource.intent}'`,
    });
  }

  const subject = resource.subject?.reference ?? null;
  const subjectIdentifier = resource.subject?.identifier?.value ?? null;
  if (!subject && !subjectIdentifier) {
    issues.push({
      severity: 'error',
      path: 'subject',
      message: 'A prescription must identify its patient, by reference or by identifier',
    });
  }

  // R4 uses medicationReference/medicationCodeableConcept; R5 uses medication.
  const medication = resource.medication ?? {};
  const medicationReference =
    resource.medicationReference?.reference ?? medication.reference?.reference ?? null;
  const coding =
    resource.medicationCodeableConcept?.coding?.[0] ?? medication.concept?.coding?.[0] ?? null;
  const medicationText =
    resource.medicationCodeableConcept?.text ?? medication.concept?.text ?? medication.display ?? null;

  if (!medicationReference && !coding && !medicationText) {
    issues.push({
      severity: 'error',
      path: 'medication',
      message: 'A prescription must say what medicine it is for',
    });
  }

  const quantityValue = resource.dispenseRequest?.quantity?.value;
  const quantity = quantityValue === undefined ? null : Number(quantityValue);
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
    issues.push({
      severity: 'error',
      path: 'dispenseRequest.quantity',
      message: 'A dispensing quantity must be a positive number',
    });
  }
  if (quantity === null) {
    issues.push({
      severity: 'warning',
      path: 'dispenseRequest.quantity',
      message: 'No quantity given; the pharmacist will have to enter one',
    });
  }

  const authoredOn = resource.authoredOn ? new Date(resource.authoredOn) : new Date();
  if (Number.isNaN(authoredOn.getTime())) {
    issues.push({ severity: 'error', path: 'authoredOn', message: 'authoredOn is not a valid date' });
  }

  const validEnd = resource.dispenseRequest?.validityPeriod?.end;
  const validUntil = validEnd ? new Date(validEnd) : null;
  if (validUntil && validUntil.getTime() < Date.now()) {
    issues.push({
      severity: 'error',
      path: 'dispenseRequest.validityPeriod.end',
      message: 'This prescription has already expired and cannot be dispensed',
    });
  }

  if (issues.some((i) => i.severity === 'error')) return { valid: false, issues };

  const identifiers: { system?: string; value?: string }[] = resource.identifier ?? [];

  return {
    valid: true,
    issues,
    value: {
      externalId: resource.id ?? null,
      prescriptionNo: identifiers[0]?.value ?? null,
      patientReference: subject ? String(subject).split('/').pop() ?? null : null,
      patientIdentifier: subjectIdentifier,
      prescriberName: resource.requester?.display ?? null,
      prescriberLicence: resource.requester?.identifier?.value ?? null,
      authoredOn,
      validUntil,
      medicationReference: medicationReference ? String(medicationReference).split('/').pop() ?? null : null,
      medicationIdentifier: coding?.code ?? null,
      medicationText,
      quantity,
      refills: Number(resource.dispenseRequest?.numberOfRepeatsAllowed ?? 0),
      dosageText: resource.dosageInstruction?.[0]?.text ?? null,
      durationDays: resource.dispenseRequest?.expectedSupplyDuration?.value ?? null,
      status: resource.status ?? 'active',
    },
  };
}
