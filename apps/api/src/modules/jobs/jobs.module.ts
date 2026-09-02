import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementModule } from '../procurement/procurement.module';

@Module({
  imports: [InventoryModule, ProcurementModule],
  providers: [RulesService],
  exports: [RulesService],
})
export class JobsModule {}
