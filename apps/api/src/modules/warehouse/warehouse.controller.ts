import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { WarehouseTasksService } from './tasks.service';
import { PickingService } from './picking.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Warehouse Operations')
@Controller('warehouse')
export class WarehouseController {
  constructor(
    private readonly locations: LocationsService,
    private readonly tasks: WarehouseTasksService,
    private readonly picking: PickingService,
  ) {}

  // ---- Locations, capacity and put-away recommendations ----

  @Get('locations')
  @RequirePermissions('admin.warehouse.READ')
  listLocations(@Query() query: any) {
    return this.locations.list(query.warehouseId, {
      locationType: query.locationType,
      level: query.level,
    });
  }

  @Post('locations')
  @RequirePermissions('admin.warehouse.CREATE')
  createLocation(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.locations.create(body, user);
  }

  @Patch('locations/:id')
  @RequirePermissions('admin.warehouse.EDIT')
  updateLocation(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.locations.update(id, body, user);
  }

  @Get('locations/by-barcode/:barcode')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'Resolve a scanned shelf label to a storage location' })
  locationByBarcode(@Param('barcode') barcode: string) {
    return this.locations.findByBarcode(barcode);
  }

  @Get('occupancy')
  @RequirePermissions('admin.warehouse.READ')
  @ApiOperation({ summary: 'Capacity and occupancy per location, with empty-bin detection' })
  occupancy(@Query('warehouseId') warehouseId: string) {
    return this.locations.occupancy(warehouseId);
  }

  @Get('bin-suggestions')
  @RequirePermissions('inventory.goods_receipt.READ')
  @ApiOperation({ summary: 'Where a product should be put away, ranked with reasons' })
  binSuggestions(@Query() query: any) {
    return this.locations.suggestBins(
      query.productId,
      query.warehouseId,
      Number(query.quantity ?? 1),
      query.limit ? Number(query.limit) : 5,
    );
  }

  @Post('validate-putaway')
  @RequirePermissions('inventory.goods_receipt.READ')
  validatePutaway(@Body() body: any) {
    return this.locations.validatePutaway(body.productId, body.locationId, Number(body.quantity ?? 0));
  }

  @Get('product-location-history')
  @RequirePermissions('inventory.ledger.READ')
  productLocationHistory(@Query() query: any) {
    return this.locations.productLocationHistory(
      query.productId,
      query.warehouseId,
      query.limit ? Number(query.limit) : 200,
    );
  }

  @Get('replenishment-needs')
  @RequirePermissions('inventory.transfer.READ')
  @ApiOperation({ summary: 'Pick faces running low, with the bulk locations that can top them up' })
  replenishmentNeeds(@Query('warehouseId') warehouseId: string) {
    return this.locations.replenishmentNeeds(warehouseId);
  }

  // ---- Tasks ----

  @Get('tasks')
  @RequirePermissions('inventory.task.READ')
  listTasks(@Query() query: any) {
    return this.tasks.list({
      warehouseId: query.warehouseId,
      status: query.status,
      taskType: query.taskType,
      assignedToId: query.assignedToId,
      waveId: query.waveId,
      open: query.open === 'true',
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get('tasks/by-type')
  @RequirePermissions('inventory.task.READ')
  @ApiOperation({ summary: 'Open task counts per task type, counted in the database' })
  tasksByType(@Query('warehouseId') warehouseId: string, @Query('open') open?: string) {
    return this.tasks.countsByType(warehouseId, open !== 'false');
  }

  @Get('tasks/exceptions')
  @RequirePermissions('inventory.task.READ')
  @ApiOperation({ summary: 'Stalled tasks, short picks and over-capacity locations' })
  exceptions(@Query('warehouseId') warehouseId: string) {
    return this.tasks.exceptions(warehouseId);
  }

  @Get('tasks/productivity')
  @RequirePermissions('analytics.report.READ')
  productivity(@Query() query: any) {
    return this.tasks.productivity(query.warehouseId, query.days ? Number(query.days) : 30);
  }

  @Get('tasks/:id')
  @RequirePermissions('inventory.task.READ')
  getTask(@Param('id') id: string) {
    return this.tasks.get(id);
  }

  @Post('tasks/moves')
  @RequirePermissions('inventory.task.CREATE')
  @ApiOperation({ summary: 'Create a bin-to-bin move or pick-face replenishment' })
  createMove(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.createMove(body, user);
  }

  @Post('tasks/:id/assign')
  @RequirePermissions('inventory.task.EDIT')
  assign(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.assign(id, body.assignedToId, user);
  }

  @Post('tasks/:id/start')
  @RequirePermissions('inventory.task.EDIT')
  start(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.start(id, user);
  }

  @Post('tasks/:id/complete')
  @RequirePermissions('inventory.task.EDIT')
  @ApiOperation({ summary: 'Complete a task, posting the stock movement it represents' })
  complete(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.complete(id, body, user);
  }

  @Post('tasks/:id/cancel')
  @RequirePermissions('inventory.task.CANCEL')
  cancelTask(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.cancel(id, body.reason, user);
  }

  @Post('goods-receipts/:id/putaway-tasks')
  @RequirePermissions('inventory.task.CREATE')
  @ApiOperation({ summary: 'Generate directed put-away tasks for a goods receipt' })
  generatePutaway(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.generatePutawayTasks(id, user);
  }

  // ---- Waves, packing, dispatch ----

  @Get('waves')
  @RequirePermissions('inventory.task.READ')
  listWaves(@Query() query: any) {
    return this.picking.listWaves(query.warehouseId, query.status);
  }

  @Get('waves/:id')
  @RequirePermissions('inventory.task.READ')
  @ApiOperation({ summary: 'A wave and its pick list, walked in bin sequence' })
  getWave(@Param('id') id: string) {
    return this.picking.getWave(id);
  }

  @Post('waves')
  @RequirePermissions('inventory.task.CREATE')
  @ApiOperation({ summary: 'Plan a picking wave; FEFO chooses the batches' })
  createWave(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.picking.createWave(body, user);
  }

  @Post('waves/:id/release')
  @RequirePermissions('inventory.task.EDIT')
  releaseWave(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.picking.releaseWave(id, user);
  }

  @Post('waves/:id/cancel')
  @RequirePermissions('inventory.task.CANCEL')
  cancelWave(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.picking.cancelWave(id, body.reason, user);
  }

  @Get('packages')
  @RequirePermissions('inventory.task.READ')
  listPackages(@Query() query: any) {
    return this.picking.listPackages(query.warehouseId, query.status);
  }

  @Post('packages')
  @RequirePermissions('inventory.task.CREATE')
  createPackage(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.picking.createPackage(body, user);
  }

  @Post('packages/:id/verify')
  @RequirePermissions('inventory.task.EDIT')
  @ApiOperation({ summary: 'Verify a packed carton against its scanned contents' })
  verifyPackage(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.picking.verifyPackage(id, body.scans ?? [], user);
  }

  @Post('packages/:id/dispatch')
  @RequirePermissions('inventory.transfer.APPROVE')
  dispatchPackage(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.picking.dispatchPackage(id, body, user);
  }

  @Get('docks')
  @RequirePermissions('admin.warehouse.READ')
  listDocks(@Query('warehouseId') warehouseId: string) {
    return this.picking.listDocks(warehouseId);
  }

  @Post('docks')
  @RequirePermissions('admin.warehouse.CREATE')
  createDock(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.picking.createDock(body, user);
  }
}
