import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchStatus, QuarantineReason, TransactionType } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { FefoService } from './fefo.service';
import { BatchService } from './batch.service';
import { LedgerService } from './ledger.service';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { ExportService } from '../reports/export.service';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly fefo: FefoService,
    private readonly batches: BatchService,
    private readonly ledgerService: LedgerService,
    private readonly scope: ScopeService,
    private readonly exports: ExportService,
  ) {}

  @Get('balances')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'Stock balances, scoped to the caller branches' })
  balances(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.listBalances(user, {
      productId: query.productId,
      warehouseId: query.warehouseId,
      branchId: query.branchId,
      locationId: query.locationId,
      search: query.search,
      onlyBelowReorder: query.onlyBelowReorder === 'true',
      onlyOutOfStock: query.onlyOutOfStock === 'true',
      onlyControlled: query.onlyControlled === 'true',
      onlyColdChain: query.onlyColdChain === 'true',
      batchStatus: query.batchStatus as BatchStatus,
      expiringWithinDays:
        query.expiringWithinDays !== undefined ? Number(query.expiringWithinDays) : undefined,
      sort: query.sort,
      direction: query.direction === 'desc' ? 'desc' : 'asc',
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
  acrossBranches(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('excludeBranchId') exclude?: string,
  ) {
    // Deliberately cross-branch: the point is "who else has this", which is how
    // a branch avoids ordering something the branch next door is about to throw
    // away. It returns availability and location only — no costs, no margins.
    return this.batches.findAcrossBranches(productId, exclude);
  }

  @Get('ledger')
  @RequirePermissions('inventory.ledger.READ')
  @ApiOperation({ summary: 'Immutable stock transaction ledger' })
  ledger(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.ledger(user, {
      productId: query.productId,
      batchId: query.batchId,
      warehouseId: query.warehouseId,
      branchId: query.branchId,
      type: query.type as TransactionType,
      referenceType: query.referenceType,
      referenceId: query.referenceId,
      search: query.search,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 100,
    });
  }

  @Get('ledger/batch/:batchId')
  @RequirePermissions('inventory.ledger.READ')
  @ApiOperation({ summary: 'One batch\'s movements oldest first, with the running balance' })
  batchLedger(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: any,
  ) {
    return this.inventory.batchLedger(user, batchId, {
      warehouseId: query.warehouseId,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Get('ledger/integrity')
  @RequirePermissions('inventory.ledger.READ')
  @ApiOperation({ summary: 'Replay the ledger and report any cached balance that drifted' })
  async integrity(
    @CurrentUser() user: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
  ) {
    // §4: a replay over every warehouse would report drift the reader is not
    // entitled to see, so a scoped user names the warehouse they are checking.
    if (warehouseId) {
      await this.scope.assertWarehouse(user, warehouseId);
    } else if (!this.scope.isUnscoped(user)) {
      throw new BadRequestException(
        'Name the warehouse to check. An organisation-wide replay is for head office.',
      );
    }
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

  @Get('expiry/calendar')
  @RequirePermissions('inventory.expiry.READ')
  @ApiOperation({ summary: 'Month-by-month expiry calendar with value at risk (§9)' })
  expiryCalendar(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.expiryCalendar(user, {
      warehouseId: query.warehouseId,
      months: query.months ? Number(query.months) : undefined,
    });
  }

  @Get('expiry/trend')
  @RequirePermissions('inventory.expiry.READ')
  @ApiOperation({ summary: 'What was actually written off to expiry, month by month (§9)' })
  expiryTrend(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.expiryTrend(user, {
      warehouseId: query.warehouseId,
      months: query.months ? Number(query.months) : undefined,
    });
  }

  @Get('expiry/comparison')
  @RequirePermissions('inventory.expiry.READ')
  @ApiOperation({ summary: 'Expiry exposure by branch, category or supplier (§9)' })
  expiryComparison(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    const dimension = ['branch', 'category', 'supplier'].includes(query.dimension)
      ? (query.dimension as 'branch' | 'category' | 'supplier')
      : 'branch';
    return this.inventory.expiryComparison(user, dimension, {
      withinDays: query.withinDays ? Number(query.withinDays) : undefined,
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
  async recommend(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    // §4: without this, any reader could enumerate another branch's batch
    // numbers, quantities and expiry dates one product at a time.
    await this.scope.assertWarehouse(user, query.warehouseId);
    return this.fefo.recommend(query.productId, query.warehouseId, {
      minRemainingDays: query.minRemainingDays ? Number(query.minRemainingDays) : undefined,
    });
  }

  @Post('fefo/allocate')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'Dry-run FEFO allocation showing chosen and excluded batches' })
  async allocate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { productId: string; warehouseId: string; quantity: number; minRemainingDays?: number },
  ) {
    await this.scope.assertWarehouse(user, body.warehouseId);
    return this.fefo.allocate(body);
  }

  @Get('batches')
  @RequirePermissions('inventory.batch.READ')
  listBatches(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.batches.findAll(user, {
      productId: query.productId,
      supplierId: query.supplierId,
      status: query.status as BatchStatus,
      search: query.search,
      onlyInStock: query.onlyInStock === 'true',
      expiringWithinDays: query.expiringWithinDays ? Number(query.expiringWithinDays) : undefined,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get('batches/:id')
  @RequirePermissions('inventory.batch.READ')
  batch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.batches.findOne(id, user);
  }

  @Post('batches/:id/split')
  @RequirePermissions('inventory.batch.EDIT')
  @ApiOperation({
    summary:
      'Split or repack part of a batch into a child batch that keeps its expiry, cost and ' +
      'supplier, recording the genealogy',
  })
  splitBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { warehouseId: string; quantity: number; newBatchNumber?: string; locationId?: string; reason: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.batches.split({ ...body, batchId: id }, user);
  }

  @Post('batches/:id/quarantine')
  @RequirePermissions('quality.quarantine.CREATE')
  @ApiOperation({ summary: 'Move a batch into quarantine (§16)' })
  quarantine(
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reason?: string; evidenceRef?: string },
  ) {
    return this.batches.changeStatus(id, BatchStatus.RELEASED, user, {
      reason: body?.reason,
      evidenceRef: body?.evidenceRef,
    });
  }

  @Post('batches/:id/block')
  @RequirePermissions('inventory.batch.EDIT')
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reason: string },
  ) {
    return this.batches.changeStatus(id, BatchStatus.BLOCKED, user, { reason: body.reason });
  }

  @Get('balances.csv')
  @RequirePermissions('inventory.balance.EXPORT')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="stock-balances.csv"')
  @ApiOperation({
    summary: 'The current stock filter as a CSV, capped so an export cannot pull the whole ledger',
  })
  async balancesCsv(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    const result = await this.inventory.listBalances(user, {
      productId: query.productId,
      warehouseId: query.warehouseId,
      branchId: query.branchId,
      locationId: query.locationId,
      search: query.search,
      onlyBelowReorder: query.onlyBelowReorder === 'true',
      onlyOutOfStock: query.onlyOutOfStock === 'true',
      onlyControlled: query.onlyControlled === 'true',
      onlyColdChain: query.onlyColdChain === 'true',
      batchStatus: query.batchStatus as BatchStatus,
      expiringWithinDays:
        query.expiringWithinDays !== undefined ? Number(query.expiringWithinDays) : undefined,
      page: 1,
      // §41: an export is the same scoped read, not a way around the page size.
      pageSize: 200,
    });

    return this.exports.toCsv(result.data, [
      { key: 'product.sku', label: 'SKU' },
      { key: 'product.genericName', label: 'Product' },
      { key: 'product.brandName', label: 'Brand' },
      { key: 'product.strength', label: 'Strength' },
      { key: 'batch.batchNumber', label: 'Batch' },
      { key: 'batch.status', label: 'Batch status' },
      { key: 'batch.expiryDate', label: 'Expires', type: 'date' },
      { key: 'daysToExpiry', label: 'Days to expiry', type: 'number' },
      { key: 'onHand', label: 'On hand', type: 'number' },
      { key: 'reserved', label: 'Reserved', type: 'number' },
      { key: 'available', label: 'Available', type: 'number' },
      { key: 'stockValue', label: 'Value at cost', type: 'number' },
      { key: 'warehouse.name', label: 'Warehouse' },
      { key: 'location.code', label: 'Location' },
    ]);
  }

  @Get('ledger.csv')
  @RequirePermissions('inventory.ledger.EXPORT')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="stock-ledger.csv"')
  async ledgerCsv(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    const result = await this.inventory.ledger(user, {
      productId: query.productId,
      batchId: query.batchId,
      warehouseId: query.warehouseId,
      branchId: query.branchId,
      type: query.type as TransactionType,
      referenceType: query.referenceType,
      search: query.search,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: 1,
      pageSize: 500,
    });

    return this.exports.toCsv(result.data, [
      { key: 'occurredAt', label: 'When', type: 'date' },
      { key: 'type', label: 'Type' },
      { key: 'product.sku', label: 'SKU' },
      { key: 'product.genericName', label: 'Product' },
      { key: 'batch.batchNumber', label: 'Batch' },
      { key: 'quantityIn', label: 'In', type: 'number' },
      { key: 'quantityOut', label: 'Out', type: 'number' },
      { key: 'balanceAfter', label: 'Balance after', type: 'number' },
      { key: 'unitCost', label: 'Unit cost', type: 'number' },
      { key: 'referenceType', label: 'Reference' },
      { key: 'referenceNo', label: 'Document' },
      { key: 'performedBy', label: 'By' },
      { key: 'reason', label: 'Reason' },
    ]);
  }

  @Get('reservations')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({ summary: 'What is holding stock out of available, and who holds it' })
  reservations(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.inventory.reservations(user, {
      productId: query.productId,
      batchId: query.batchId,
      warehouseId: query.warehouseId,
      referenceType: query.referenceType,
      includeReleased: query.includeReleased === 'true',
      onlyLapsed: query.onlyLapsed === 'true',
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Post('reservations/:id/release')
  @RequirePermissions('inventory.balance.EDIT')
  @ApiOperation({
    summary:
      'Release a hold by hand. The document it belongs to is left alone — releasing the stock ' +
      'is not the same decision as cancelling the order.',
  })
  releaseReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.releaseReservation(id, body?.reason, user);
  }

  @Get('anomalies')
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({
    summary:
      'Stock positions that need a person: negative balances, over-reservation, holds at zero, ' +
      'and expired stock still counted as available',
  })
  anomalies(@CurrentUser() user: AuthenticatedUser, @Query('warehouseId') warehouseId?: string) {
    return this.inventory.anomalies(user, { warehouseId });
  }

  @Post('expiry/sweep')
  @RequirePermissions('inventory.expiry.READ', 'inventory.adjustment.APPROVE')
  @ApiOperation({ summary: 'Run the expired-stock sweep immediately' })
  sweep(@CurrentUser() user: AuthenticatedUser) {
    return this.batches.processExpiredBatches(user.id);
  }
}
