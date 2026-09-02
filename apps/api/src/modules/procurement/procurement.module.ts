import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { SuppliersService } from './suppliers.service';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [ProcurementController],
  providers: [ProcurementService, SuppliersService, InvoicesService],
  exports: [ProcurementService, SuppliersService, InvoicesService],
})
export class ProcurementModule {}
