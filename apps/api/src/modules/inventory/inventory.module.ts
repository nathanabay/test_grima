import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LedgerService } from './ledger.service';
import { FefoService } from './fefo.service';
import { BatchService } from './batch.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, LedgerService, FefoService, BatchService],
  exports: [InventoryService, LedgerService, FefoService, BatchService],
})
export class InventoryModule {}
