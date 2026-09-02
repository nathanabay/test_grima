import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { JobRunnerService } from './job-runner.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [InventoryModule, ProcurementModule, AccountingModule, AutomationModule],
  providers: [JobRunnerService, RulesService],
  exports: [JobRunnerService, RulesService],
})
export class JobsModule {}
