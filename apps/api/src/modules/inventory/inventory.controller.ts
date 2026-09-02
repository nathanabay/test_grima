import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchStatus, QuarantineReason } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { FefoService } from './fefo.service';
import { BatchService } from './batch.service';
import { LedgerService } from './ledger.service';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly fefo: FefoService,
    private readonly batches: BatchService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Get('balances')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'Stock balances, scoped to the caller branches' })
  balances(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.listBalances(user, {
      productId: query.productId,
      warehouseId: query.warehouseId,
      branchId: query.branchId,
      search: query.search,
      onlyBelowReorder: query.onlyBelowReorder === 'true',
      onlyOutOfStock: query.onlyOutOfStock === 'true',
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get('products/:productId/stock')
  @RequirePermissions('inventory.balance.READ')
  productStock(@Param('productId') productId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventory.productStock(productId, user);
  }

  @Get('products/:productId/branches')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'Inter-branch availability search (§34)' })
  acrossBranches(@Param('productId') productId: string, @Query('excludeBranchId') exclude?: string) {
    return this.batches.findAcrossBranches(productId, exclude);
  }

  @Get('ledger')
  @RequirePermissions('inventory.ledger.READ')
  @ApiOperation({ summary: 'Immutable stock transaction ledger' })
  ledger(@Query() query: any) {
    return this.inventory.ledger({
      productId: query.productId,
      batchId: query.batchId,
      warehouseId: query.warehouseId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 100,
    });
  }

  @Get('ledger/integrity')
  @RequirePermissions('inventory.ledger.READ')
  @ApiOperation({ summary: 'Replay the ledger and report any cached balance that drifted' })
  integrity(@Query('warehouseId') warehouseId?: string) {
    return this.ledgerService.verifyIntegrity(warehouseId);
  }

  @Get('expiry')
  @RequirePermissions('inventory.expiry.READ')
  @ApiOperation({ summary: 'Expiry dashboard with value at risk (§9)' })
  expiry(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.expiryReport(user, {
      warehouseId: query.warehouseId,
      maxDays: query.maxDays ? Number(query.maxDays) : undefined,
    });
  }

  @Get('expiry/redistribution')
  @RequirePermissions('inventory.expiry.READ')
  @ApiOperation({ summary: 'Smart expiry redistribution suggestions across branches (§10)' })
  redistribution(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.redistributionSuggestions(user, {
      withinDays: query.withinDays ? Number(query.withinDays) : undefined,
      transferLeadTimeDays: query.leadTime ? Number(query.leadTime) : undefined,
    });
  }

  @Get('fefo/recommend')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'The batch FEFO recommends for a product in a warehouse' })
  recommend(@Query() query: any) {
    return this.fefo.recommend(query.productId, query.warehouseId, {
      minRemainingDays: query.minRemainingDays ? Number(query.minRemainingDays) : undefined,
    });
  }

  @Post('fefo/allocate')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'Dry-run FEFO allocation showing chosen and excluded batches' })
  allocate(@Body() body: { productId: string; warehouseId: string; quantity: number; minRemainingDays?: number }) {
    return this.fefo.allocate(body);
  }

  @Get('batches')
  @RequirePermissions('inventory.batch.READ')
  listBatches(@Query() query: any) {
    return this.batches.findAll({
      productId: query.productId,
      status: query.status as BatchStatus,
      search: query.search,
      expiringWithinDays: query.expiringWithinDays ? Number(query.expiringWithinDays) : undefined,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get('batches/:id')
  @RequirePermissions('inventory.batch.READ')
  batch(@Param('id') id: string) {
    return this.batches.findOne(id);
  }

  @Post('batches/:id/quarantine')
  @RequirePermissions('quality.quarantine.CREATE')
  @ApiOperation({ summary: 'Move a batch into quarantine (§16)' })
  quarantine(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reason: string; quarantineReason: QuarantineReason },
  ) {
    return this.batches.changeStatus(id, BatchStatus.QUARANTINED, user, {
      reason: body.reason,
      quarantineReason: body.quarantineReason,
    });
  }

  @Post('batches/:id/release')
  @RequirePermissions('quality.quarantine.APPROVE')
  @ApiOperation({ summary: 'QA release: makes the batch allocatable by FEFO' })
  release(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reason?: string },
  ) {
    return this.batches.changeStatus(id, BatchStatus.RELEASED, user, { reason: body?.reason });
  }

  @Post('batches/:id/block')
  @RequirePermissions('inventory.batch.EDIT')
  block(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reason: string },
  ) {
    return this.batches.changeStatus(id, BatchStatus.BLOCKED, user, { reason: body.reason });
  }

  @Post('expiry/sweep')
  @RequirePermissions('inventory.expiry.READ', 'inventory.adjustment.APPROVE')
  @ApiOperation({ summary: 'Run the expired-stock sweep immediately' })
  sweep(@CurrentUser() user: AuthenticatedUser) {
    return this.batches.processExpiredBatches(user.id);
  }
}
