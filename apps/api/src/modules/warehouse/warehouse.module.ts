import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { LocationsService } from './locations.service';
import { WarehouseTasksService } from './tasks.service';
import { PickingService } from './picking.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [WarehouseController],
  providers: [LocationsService, WarehouseTasksService, PickingService],
  exports: [LocationsService, WarehouseTasksService, PickingService],
})
export class WarehouseModule {}
