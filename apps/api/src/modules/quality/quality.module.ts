import { Module } from '@nestjs/common';
import { QualityController } from './quality.controller';
import { ReturnsService } from './returns.service';
import { DisposalService } from './disposal.service';
import { ColdChainService } from '../coldchain/coldchain.service';
import { IncidentsService } from './incidents.service';
import { DamageService } from './damage.service';
import { IncidentsController } from './incidents.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [QualityController, IncidentsController],
  providers: [ReturnsService, DisposalService, ColdChainService, IncidentsService, DamageService],
  exports: [ReturnsService, DisposalService, ColdChainService, IncidentsService, DamageService],
})
export class QualityModule {}
