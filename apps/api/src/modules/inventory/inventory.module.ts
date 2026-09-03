import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LedgerService } from './ledger.service';
import { FefoService } from './fefo.service';
import { BatchService } from './batch.service';
import { ExportService } from '../reports/export.service';

@Module({
  controllers: [InventoryController],
  // ExportService is a stateless formatter with no dependencies of its own, so
  // it is provided here rather than importing ReportsModule — which would pull
  // the analytics graph in behind it for the sake of a CSV writer.
  providers: [InventoryService, LedgerService, FefoService, BatchService, ExportService],
  exports: [InventoryService, LedgerService, FefoService, BatchService],
})
export class InventoryModule {}
