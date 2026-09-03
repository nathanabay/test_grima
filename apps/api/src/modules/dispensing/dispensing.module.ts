import { Module } from '@nestjs/common';
import { DispensingController } from './dispensing.controller';
import { DispensingService } from './dispensing.service';
import { PrescriptionsService } from './prescriptions.service';
import { ControlledRegisterService } from './controlled-register.service';
import { ClinicalChecksService } from './clinical-checks.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [DispensingController],
  providers: [
    DispensingService,
    PrescriptionsService,
    ControlledRegisterService,
    ClinicalChecksService,
  ],
  exports: [DispensingService, PrescriptionsService, ControlledRegisterService, ClinicalChecksService],
})
export class DispensingModule {}
