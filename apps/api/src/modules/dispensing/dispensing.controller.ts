import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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

  @Get('prescriptions')
  @RequirePermissions('dispensing.prescription.READ')
  listPrescriptions(@Query() query: any) {
    return this.prescriptions.findAll({
      status: query.status as PrescriptionStatus,
      patientId: query.patientId,
      branchId: query.branchId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('prescriptions/:id')
  @RequirePermissions('dispensing.prescription.READ')
  prescription(@Param('id') id: string) {
    return this.prescriptions.findOne(id);
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
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVE' | 'REJECT'; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.prescriptions.review(id, body.decision, user, body.reason);
  }

  @Post('dispensing')
  @RequirePermissions('dispensing.dispensing.CREATE')
  @ApiOperation({
    summary: 'Dispense medicines using FEFO allocation, with safety and controlled-drug checks',
  })
  dispense(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.dispensing.dispense(body, user);
  }

  @Get('dispensing')
  @RequirePermissions('dispensing.dispensing.READ')
  listDispensings(@Query() query: any) {
    return this.dispensing.findAll({
      patientId: query.patientId,
      branchId: query.branchId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('dispensing/:id')
  @RequirePermissions('dispensing.dispensing.READ')
  dispensingRecord(@Param('id') id: string) {
    return this.dispensing.findOne(id);
  }

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
    @Param('id') id: string,
    @Body() body: { reason: string; witnessedById?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.controlled.reverse(id, body.reason, user, body.witnessedById);
  }
}
