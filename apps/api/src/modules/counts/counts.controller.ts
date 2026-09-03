import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CountType } from '@prisma/client';
import { CountsService } from './counts.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Stock Counts & Adjustments')
@Controller()
export class CountsController {
  constructor(private readonly counts: CountsService) {}

  @Get('stock-counts')
  @RequirePermissions('inventory.count.READ')
  list(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.findAll(
      {
        warehouseId: query.warehouseId,
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 25,
      },
      user,
    );
  }

  @Get('stock-counts/:id')
  @RequirePermissions('inventory.count.READ')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.findOne(id, user);
  }

  @Post('stock-counts')
  @RequirePermissions('inventory.count.CREATE')
  @ApiOperation({
    summary:
      'Open a count and snapshot system quantities. Scope depends on countType: ' +
      'FULL (branch), WAREHOUSE, CATEGORY (needs categoryId), BIN (needs locationId), ' +
      'CYCLE and RANDOM (both accept sampleSize).',
  })
  create(
    @Body()
    body: {
      warehouseId: string;
      branchId: string;
      countType: CountType;
      productIds?: string[];
      locationId?: string;
      categoryId?: string;
      sampleSize?: number;
      isBlind?: boolean;
      freeze?: boolean;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.counts.create(body, user);
  }

  @Post('stock-counts/:id/scan')
  @RequirePermissions('inventory.count.EDIT')
  @ApiOperation({ summary: 'Record a counted quantity by scanning the pack (§21)' })
  scan(
    @Param('id') id: string,
    @Body() body: { code: string; countedQty: number; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.counts.recordByScan(id, body, user);
  }

  @Post('stock-counts/:id/record')
  @RequirePermissions('inventory.count.EDIT')
  record(
    @Param('id') id: string,
    @Body() body: { lines: Array<{ itemId: string; countedQty: number; reason?: string }> },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.counts.recordCounts(id, body.lines, user);
  }

  @Post('stock-counts/:id/post')
  @RequirePermissions('inventory.count.EDIT')
  @ApiOperation({ summary: 'Post variances as adjustments; large variances need approval' })
  post(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.post(id, user);
  }

  @Post('stock-counts/:id/freeze')
  @RequirePermissions('inventory.count.EDIT')
  @ApiOperation({
    summary: 'Freeze the counted positions so no movement can change them mid-count (§21)',
  })
  freeze(
    @Param('id') id: string,
    @Body() body: { freeze?: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.counts.setFreeze(id, body?.freeze !== false, user);
  }

  @Get('stock-adjustments/loss-analysis')
  @RequirePermissions('inventory.adjustment.READ')
  @ApiOperation({ summary: 'Shrinkage by cause and by product (§21)' })
  lossAnalysis(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.lossAnalysis(
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        warehouseId: query.warehouseId,
        branchId: query.branchId,
      },
      user,
    );
  }

  @Post('stock-adjustments')
  @RequirePermissions('inventory.adjustment.CREATE')
  adjust(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.adjust(body, user);
  }
}
