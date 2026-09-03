import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrescriptionStatus } from '@prisma/client';
import { DispensingService } from './dispensing.service';
import { PrescriptionsService } from './prescriptions.service';
import { ControlledRegisterService } from './controlled-register.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Prescriptions & Dispensing')
@Controller()
export class DispensingController {
  constructor(
    private readonly dispensing: DispensingService,
    private readonly prescriptions: PrescriptionsService,
    private readonly controlled: ControlledRegisterService,
  ) {}

  // ---- Prescriptions ----

  /**
   * Declared before `prescriptions/:id` so "queue" is not read as an id.
   */
  @Get('prescriptions/queue')
  @RequirePermissions('dispensing.prescription.READ')
  @ApiOperation({
    summary: 'The dispensing queue: urgent first, then longest waiting, with waiting times',
  })
  queue(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptions.queue(user, {
      branchId: query.branchId,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Get('prescriptions')
  @RequirePermissions('dispensing.prescription.READ')
  listPrescriptions(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptions.findAll(user, {
      status: query.status as PrescriptionStatus,
      patientId: query.patientId,
      branchId: query.branchId,
      search: query.search,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('prescriptions/:id')
  @RequirePermissions('dispensing.prescription.READ')
  prescription(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptions.findOne(id, user);
  }

  @Post('prescriptions')
  @RequirePermissions('dispensing.prescription.CREATE')
  createPrescription(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptions.create(body, user);
  }

  @Post('prescriptions/:id/review')
  @RequirePermissions('dispensing.prescription.APPROVE')
  @ApiOperation({ summary: 'Pharmacist validation: approve or reject a prescription' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { decision: 'APPROVE' | 'REJECT'; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.prescriptions.review(id, body.decision, user, body.reason);
  }

  @Post('prescriptions/:id/cancel')
  @RequirePermissions('dispensing.prescription.CANCEL')
  @ApiOperation({ summary: 'Cancel a prescription nothing has been supplied against' })
  cancelPrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.prescriptions.cancel(id, body?.reason, user);
  }

  @Post('prescriptions/:id/ready')
  @RequirePermissions('dispensing.dispensing.CREATE')
  @ApiOperation({ summary: 'Made up and on the collection shelf' })
  markReady(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptions.markReady(id, user);
  }

  @Post('prescriptions/:id/collect')
  @RequirePermissions('dispensing.dispensing.CREATE')
  @ApiOperation({ summary: 'Handed over, recording who collected it' })
  markCollected(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { collectedBy: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.prescriptions.markCollected(id, body?.collectedBy, user);
  }

  @Post('prescriptions/:id/refill')
  @RequirePermissions('dispensing.prescription.CREATE')
  @ApiOperation({
    summary: 'Issue the next repeat as a new prescription, within the allowance on the original',
  })
  refill(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptions.refill(id, user);
  }

  // ---- Dispensing ----

  @Post('dispensing/preview')
  @RequirePermissions('dispensing.dispensing.READ')
  @ApiOperation({
    summary:
      'Run the clinical checks and show what FEFO would allocate, without dispensing anything',
  })
  preview(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.preview(body, user);
  }

  @Post('dispensing')
  @RequirePermissions('dispensing.dispensing.CREATE')
  @ApiOperation({
    summary: 'Dispense medicines using FEFO allocation, with safety and controlled-drug checks',
  })
  dispense(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.dispense(body, user);
  }

  @Get('dispensing/summary/today')
  @RequirePermissions('dispensing.dispensing.READ')
  todaySummary(@Query('branchId') branchId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.todaySummary(user, branchId);
  }

  @Get('dispensing/workload')
  @RequirePermissions('dispensing.dispensing.READ')
  @ApiOperation({ summary: 'Dispensing volume per pharmacist — a workload measure, not a score' })
  workload(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.workload(user, {
      branchId: query.branchId,
      days: query.days ? Number(query.days) : undefined,
    });
  }

  @Get('dispensing/patient/:patientId')
  @RequirePermissions('dispensing.dispensing.READ')
  @ApiOperation({ summary: 'What this patient has been supplied, newest first' })
  patientHistory(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('limit') limit: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispensing.patientHistory(patientId, user, limit ? Number(limit) : undefined);
  }

  @Get('dispensing')
  @RequirePermissions('dispensing.dispensing.READ')
  listDispensings(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.findAll(user, {
      patientId: query.patientId,
      branchId: query.branchId,
      prescriptionId: query.prescriptionId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('dispensing/:id')
  @RequirePermissions('dispensing.dispensing.READ')
  dispensingRecord(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.findOne(id, user);
  }

  @Post('dispensing/:id/reverse')
  @RequirePermissions('dispensing.dispensing.CANCEL')
  @ApiOperation({
    summary:
      'Reverse a dispensing: put the stock back, restore what is outstanding, and append a ' +
      'controlled-register reversal. The original record is kept, never edited.',
  })
  reverseDispensing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string; returnToStock?: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispensing.reverse(id, body ?? ({} as any), user);
  }

  @Get('dispensing/:id/label')
  @RequirePermissions('dispensing.dispensing.PRINT')
  @ApiOperation({
    summary:
      'Everything the dispensing label needs — product, batch, expiry, directions and ' +
      'cautionary wording — read together so a label cannot mix rows',
  })
  labelData(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.labelData(id, user);
  }

  @Post('dispensing/:id/label')
  @RequirePermissions('dispensing.dispensing.PRINT')
  @ApiOperation({ summary: 'Count a label print. Reprints are recorded, not prevented.' })
  recordLabelPrint(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.recordLabelPrint(id, user);
  }

  // ---- Controlled medicines register ----

  @Get('controlled-register')
  @RequirePermissions('dispensing.controlled.READ')
  @ApiOperation({ summary: 'Controlled medicines register (append-only)' })
  register(@Query() query: any) {
    return this.controlled.register({
      productId: query.productId,
      branchId: query.branchId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 100,
    });
  }

  @Get('controlled-register/anomalies')
  @RequirePermissions('dispensing.controlled.READ')
  @ApiOperation({
    summary:
      'Patterns in the controlled register worth investigating: volume outliers, unusual ' +
      'quantities, out-of-hours entries, missing witnesses, prescriber concentration (§28)',
  })
  anomalies(@Query() query: any) {
    return this.controlled.anomalies({
      branchId: query.branchId,
      productId: query.productId,
      days: query.days ? Number(query.days) : undefined,
    });
  }

  @Get('controlled-register/reconcile')
  @RequirePermissions('dispensing.controlled.READ')
  reconcile(@Query('productId') productId: string, @Query('branchId') branchId: string) {
    return this.controlled.reconcile(productId, branchId);
  }

  @Post('controlled-register/:id/reverse')
  @RequirePermissions('dispensing.controlled.CREATE')
  @ApiOperation({ summary: 'Append a reversal entry; register rows are never edited or deleted' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string; witnessedById?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.controlled.reverse(id, body.reason, user, body.witnessedById);
  }
}
