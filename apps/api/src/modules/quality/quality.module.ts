import { Module } from '@nestjs/common';
import { QualityController } from './quality.controller';
import { ReturnsService } from './returns.service';
import { DisposalService } from './disposal.service';
import { ColdChainService } from '../coldchain/coldchain.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [QualityController],
  providers: [ReturnsService, DisposalService, ColdChainService],
  exports: [ReturnsService, DisposalService, ColdChainService],
})
export class QualityModule {}
