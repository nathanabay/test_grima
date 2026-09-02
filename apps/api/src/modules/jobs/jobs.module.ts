import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { JobRunnerService } from './job-runner.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementModule } from '../procurement/procurement.module';

@Module({
  imports: [InventoryModule, ProcurementModule],
  providers: [JobRunnerService, RulesService],
  exports: [JobRunnerService, RulesService],
})
export class JobsModule {}
