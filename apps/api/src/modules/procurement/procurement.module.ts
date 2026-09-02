import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [ProcurementController],
  providers: [ProcurementService, SuppliersService],
  exports: [ProcurementService, SuppliersService],
})
export class ProcurementModule {}
