import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FhirService } from './fhir.service';
import { AuthenticatedUser, CurrentUser, Public, RequirePermissions } from '../../common/decorators';

/**
 * FHIR R4 endpoints (§54).
 *
 * Authorised by the same permissions a person would need: reading a Patient
 * resource requires the patient-data permission, so an integration cannot see
 * anything a role could not.
 */
@ApiTags('FHIR Interoperability')
@Controller('fhir')
export class FhirController {
  constructor(private readonly fhir: FhirService) {}

  @Get('metadata')
  @Public()
  @ApiOperation({ summary: 'CapabilityStatement — what this server supports' })
  metadata() {
    return this.fhir.capability();
  }

  // ---- Patient ----

  @Get('Patient/:id')
  @RequirePermissions('sales.patient.READ')
  readPatient(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fhir.readPatient(id, user);
  }

  @Get('Patient')
  @RequirePermissions('sales.patient.READ')
  searchPatients(@Query() query: any) {
    return this.fhir.searchPatients(query);
  }

  @Post('Patient')
  @RequirePermissions('sales.patient.CREATE')
  @ApiOperation({ summary: 'Accept a Patient; idempotent on the X-Idempotency-Key header' })
  ingestPatient(
    @Body() body: any,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fhir.ingestPatient(body, { idempotencyKey, user });
  }

  // ---- Practitioner and Organization ----

  @Get('Practitioner')
  @RequirePermissions('admin.user.READ')
  searchPractitioners(@Query() query: any) {
    return this.fhir.searchPractitioners(query);
  }

  @Get('Organization')
  @RequirePermissions('admin.branch.READ')
  searchOrganizations() {
    return this.fhir.searchOrganizations();
  }

  // ---- Medication ----

  @Get('Medication/:id')
  @RequirePermissions('catalog.product.READ')
  readMedication(@Param('id') id: string) {
    return this.fhir.readMedication(id);
  }

  @Get('Medication')
  @RequirePermissions('catalog.product.READ')
  searchMedications(@Query() query: any) {
    return this.fhir.searchMedications(query);
  }

  // ---- MedicationRequest ----

  @Get('MedicationRequest/:prescriptionId')
  @RequirePermissions('dispensing.prescription.READ')
  readMedicationRequest(@Param('prescriptionId') id: string) {
    return this.fhir.readMedicationRequest(id);
  }

  @Post('MedicationRequest')
  @RequirePermissions('dispensing.prescription.CREATE')
  @ApiOperation({
    summary:
      'Accept an electronic prescription. Registered for pharmacist review; never dispensed automatically.',
  })
  ingestMedicationRequest(
    @Body() body: any,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fhir.ingestMedicationRequest(body, { idempotencyKey, user });
  }

  // ---- MedicationDispense ----

  @Get('MedicationDispense/:dispensingId')
  @RequirePermissions('dispensing.dispensing.READ')
  @ApiOperation({ summary: 'What was handed over, including batch and expiry' })
  readMedicationDispense(@Param('dispensingId') id: string) {
    return this.fhir.readMedicationDispense(id);
  }

  // ---- Exchange log ----

  @Get('_log/exchanges')
  @RequirePermissions('admin.setting.READ')
  exchanges(@Query() query: any) {
    return this.fhir.exchanges({
      direction: query.direction,
      resourceType: query.resourceType,
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get('_log/health')
  @RequirePermissions('admin.setting.READ')
  health() {
    return this.fhir.health();
  }
}
