import { Module } from '@nestjs/common';
import { CountsController } from './counts.controller';
import { CountsService } from './counts.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [CountsController],
  providers: [CountsService],
  exports: [CountsService],
})
export class CountsModule {}
