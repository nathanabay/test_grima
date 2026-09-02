/**
 * FHIR mapping (§54).
 *
 * The mapper is pure, so the rules that matter — what is required, what is
 * rejected, and what is deliberately left out rather than invented — are
 * tested without a database.
 */

import {
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
} from '../src/modules/fhir/fhir.mapper';

const patient = {
  id: 'p1',
  patientCode: 'PT-000001',
  fullName: 'Abebe Kebede',
  dateOfBirth: new Date('1985-03-14T00:00:00Z'),
  sex: 'M',
  phone: '+251911223344',
  email: null,
  addressLine: 'Bole Road 12',
  city: 'Addis Ababa',
  isActive: true,
  preferredLanguage: 'am',
};

describe('Patient, outbound', () => {
  it('produces a valid R4 Patient', () => {
    const resource = toFhirPatient(patient);
    expect(resource.resourceType).toBe('Patient');
    expect(resource.id).toBe('p1');
    expect(resource.gender).toBe('male');
    expect(resource.birthDate).toBe('1985-03-14');
    expect(resource.active).toBe(true);
  });

  it('carries the patient code as an identifier', () => {
    const resource = toFhirPatient(patient);
    expect(resource.identifier[0]).toEqual({
      system: 'urn:pharmacore:patient-code',
      value: 'PT-000001',
    });
  });

  it('always sends the full name as text', () => {
    // Ethiopian names do not split into family and given the way the resource
    // assumes, so the whole name is authoritative and the parts are a
    // convenience for systems that need them.
    const resource = toFhirPatient(patient);
    expect(resource.name[0].text).toBe('Abebe Kebede');
  });

  it('omits a field it has no source for rather than inventing one', () => {
    const resource = toFhirPatient({ ...patient, dateOfBirth: null, sex: null, phone: null });
    expect(resource.birthDate).toBeUndefined();
    expect(resource.gender).toBeUndefined();
    expect(resource).not.toHaveProperty('maritalStatus');
    expect(resource).not.toHaveProperty('deceasedBoolean');
  });
});

describe('Patient, inbound', () => {
  const valid = {
    resourceType: 'Patient',
    identifier: [{ system: 'urn:pharmacore:patient-code', value: 'EHR-1' }],
    name: [{ given: ['Tigist'], family: 'Alemu' }],
    gender: 'female',
    birthDate: '1990-04-12',
    telecom: [{ system: 'phone', value: '+251900000000' }],
  };

  it('accepts a well-formed resource', () => {
    const result = fromFhirPatient(valid);
    expect(result.valid).toBe(true);
    expect(result.value?.fullName).toBe('Tigist Alemu');
    expect(result.value?.sex).toBe('F');
    expect(result.value?.patientCode).toBe('EHR-1');
  });

  it('rejects the wrong resource type', () => {
    const result = fromFhirPatient({ resourceType: 'Observation' });
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toMatch(/Expected a Patient/);
  });

  it('rejects a resource with no usable name', () => {
    const result = fromFhirPatient({ ...valid, name: [] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === 'name' && i.severity === 'error')).toBe(true);
  });

  it('accepts a name given only as text', () => {
    const result = fromFhirPatient({ ...valid, name: [{ text: 'Single Name' }] });
    expect(result.valid).toBe(true);
    expect(result.value?.fullName).toBe('Single Name');
  });

  it('rejects an unparseable date of birth', () => {
    const result = fromFhirPatient({ ...valid, birthDate: 'not-a-date' });
    expect(result.valid).toBe(false);
  });

  it('rejects a date of birth in the future', () => {
    const result = fromFhirPatient({ ...valid, birthDate: '2099-01-01' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('future'))).toBe(true);
  });

  it('rejects a gender outside the FHIR value set', () => {
    const result = fromFhirPatient({ ...valid, gender: 'yes' });
    expect(result.valid).toBe(false);
  });

  it('warns, but accepts, when there is no way to contact the patient', () => {
    // A recall needs a phone number. Refusing the record would be worse than
    // accepting it and saying so.
    const result = fromFhirPatient({ ...valid, telecom: [] });
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && i.path === 'telecom')).toBe(true);
  });
});

describe('MedicationRequest, inbound', () => {
  const valid = {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    subject: { identifier: { value: 'PT-000001' } },
    medicationCodeableConcept: { coding: [{ code: 'SKU-0003' }], text: 'Amoxicillin 500mg' },
    requester: { display: 'Dr Selam Bekele', identifier: { value: 'MD-2291' } },
    dosageInstruction: [{ text: 'One tablet twice daily' }],
    dispenseRequest: { quantity: { value: 20 }, numberOfRepeatsAllowed: 1 },
  };

  it('accepts a well-formed order', () => {
    const result = fromFhirMedicationRequest(valid);
    expect(result.valid).toBe(true);
    expect(result.value?.quantity).toBe(20);
    expect(result.value?.prescriberName).toBe('Dr Selam Bekele');
    expect(result.value?.dosageText).toBe('One tablet twice daily');
    expect(result.value?.refills).toBe(1);
  });

  it('rejects anything that is not an order', () => {
    // A proposal or a plan is not something a pharmacy may dispense against.
    const result = fromFhirMedicationRequest({ ...valid, intent: 'proposal' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === 'intent')).toBe(true);
  });

  it('rejects a request with no patient', () => {
    const result = fromFhirMedicationRequest({ ...valid, subject: undefined });
    expect(result.valid).toBe(false);
  });

  it('rejects a request that does not say what medicine it is for', () => {
    const result = fromFhirMedicationRequest({
      ...valid,
      medicationCodeableConcept: undefined,
      medication: undefined,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a non-positive quantity', () => {
    expect(
      fromFhirMedicationRequest({ ...valid, dispenseRequest: { quantity: { value: 0 } } }).valid,
    ).toBe(false);
    expect(
      fromFhirMedicationRequest({ ...valid, dispenseRequest: { quantity: { value: -5 } } }).valid,
    ).toBe(false);
  });

  it('rejects a prescription that has already expired', () => {
    const result = fromFhirMedicationRequest({
      ...valid,
      dispenseRequest: { ...valid.dispenseRequest, validityPeriod: { end: '2020-01-01' } },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('expired'))).toBe(true);
  });

  it('warns when no quantity is given rather than guessing one', () => {
    const result = fromFhirMedicationRequest({ ...valid, dispenseRequest: {} });
    expect(result.valid).toBe(true);
    expect(result.value?.quantity).toBeNull();
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('reads the R5 medication shape as well as the R4 one', () => {
    const result = fromFhirMedicationRequest({
      ...valid,
      medicationCodeableConcept: undefined,
      medication: { concept: { coding: [{ code: 'SKU-0003' }], text: 'Amoxicillin' } },
    });
    expect(result.valid).toBe(true);
    expect(result.value?.medicationIdentifier).toBe('SKU-0003');
  });
});

describe('Outbound resources are R4-shaped', () => {
  it('uses the R4 spellings on Medication', () => {
    const resource = toFhirMedication({
      id: 'm1',
      sku: 'SKU-1',
      gtin: '8901234567890',
      genericName: 'Amoxicillin',
      brandName: 'Amoxil',
      strength: '500 mg',
      dosageForm: 'Capsule',
      atcCode: 'J01CA04',
      isActive: true,
      ingredients: [{ name: 'Amoxicillin trihydrate', strengthValue: '500', strengthUnit: 'mg' }],
    });

    // R5 spells these doseForm and item; the CapabilityStatement advertises R4.
    expect(resource).toHaveProperty('form');
    expect(resource).not.toHaveProperty('doseForm');
    expect(resource.ingredient?.[0]).toHaveProperty('itemCodeableConcept');
    expect(resource.code.coding[0].system).toBe('http://www.whocc.no/atc');
  });

  it('uses medicationReference on a MedicationRequest', () => {
    const [resource] = toFhirMedicationRequests({
      id: 'rx1',
      prescriptionNo: 'RX-1',
      status: 'APPROVED',
      prescribedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      patientId: 'p1',
      prescriberName: 'Dr X',
      prescriberLicence: 'MD-1',
      notes: null,
      items: [
        {
          id: 'i1',
          productId: 'm1',
          productName: 'Amoxicillin 500 mg',
          quantityPrescribed: '20',
          dosageInstructions: 'One twice daily',
          frequency: 'BD',
          durationDays: 10,
          refillsAllowed: 0,
        },
      ],
    });

    expect(resource.medicationReference.reference).toBe('Medication/m1');
    expect(resource.status).toBe('active');
    expect(resource.intent).toBe('order');
  });

  it('carries the batch and expiry actually handed over', () => {
    // The single most useful thing a receiving system can have for a recall.
    const [resource] = toFhirMedicationDispenses({
      id: 'd1',
      dispensingNo: 'DSP-1',
      dispensedAt: new Date('2026-02-01T00:00:00Z'),
      patientId: 'p1',
      prescriptionId: 'rx1',
      prescriptionNo: 'RX-1',
      branchId: 'b1',
      pharmacistName: 'Selam',
      items: [
        {
          id: 'i1',
          productId: 'm1',
          productName: 'Amoxicillin 500 mg',
          batchNumber: 'AMX-2026-001',
          expiryDate: new Date('2027-06-30T00:00:00Z'),
          quantity: '20',
          instructions: null,
        },
      ],
    });

    const extension = (resource.extension ?? []) as { url: string; valueString?: string; valueDate?: string }[];
    const batch = extension.find((e) => e.url === 'urn:pharmacore:batch');
    const expiry = extension.find((e) => e.url === 'urn:pharmacore:expiry');
    expect(batch?.valueString).toBe('AMX-2026-001');
    expect(expiry?.valueDate).toBe('2027-06-30');
  });

  it('maps every prescription status onto the FHIR value set', () => {
    const allowed = ['draft', 'active', 'completed', 'cancelled', 'stopped', 'unknown'];
    for (const status of [
      'DRAFT',
      'NEW',
      'APPROVED',
      'PARTIALLY_DISPENSED',
      'DISPENSED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED',
    ]) {
      const [resource] = toFhirMedicationRequests({
        id: 'rx',
        prescriptionNo: 'RX',
        status,
        prescribedAt: new Date(),
        expiresAt: null,
        patientId: 'p',
        prescriberName: null,
        prescriberLicence: null,
        notes: null,
        items: [
          {
            id: 'i',
            productId: 'm',
            productName: 'x',
            quantityPrescribed: '1',
            dosageInstructions: null,
            frequency: null,
            durationDays: null,
            refillsAllowed: 0,
          },
        ],
      });
      expect(allowed).toContain(resource.status);
    }
  });

  it('produces a searchset Bundle', () => {
    const bundle = toBundle([toFhirPatient(patient)]);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('searchset');
    expect(bundle.total).toBe(1);
    expect((bundle.entry[0].resource as { resourceType: string }).resourceType).toBe('Patient');
  });

  it('reports failures as an OperationOutcome', () => {
    const outcome = operationOutcome([
      { severity: 'error', path: 'name', message: 'A patient must carry a name' },
    ]);
    expect(outcome.resourceType).toBe('OperationOutcome');
    expect(outcome.issue[0].severity).toBe('error');
    expect(outcome.issue[0].code).toBe('invalid');
  });

  it('advertises the version it actually emits', () => {
    expect(SUPPORTED_FHIR_VERSION).toBe('4.0.1');
  });

  it('maps a branch to an Organization', () => {
    const resource = toFhirOrganization({
      id: 'b1',
      code: 'ADD01',
      name: 'Addis Pharmacy 01',
      branchType: 'PHARMACY',
      licenseNumber: 'EFDA-1',
      phone: '+251',
      email: null,
      addressLine: null,
      city: 'Addis Ababa',
      isActive: true,
    });
    expect(resource.resourceType).toBe('Organization');
    expect(resource.identifier).toHaveLength(2);
    expect(resource.name).toBe('Addis Pharmacy 01');
  });
});
