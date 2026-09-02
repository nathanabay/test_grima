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
  list(@Query() query: any) {
    return this.counts.findAll({
      warehouseId: query.warehouseId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('stock-counts/:id')
  @RequirePermissions('inventory.count.READ')
  findOne(@Param('id') id: string) {
    return this.counts.findOne(id);
  }

  @Post('stock-counts')
  @RequirePermissions('inventory.count.CREATE')
  @ApiOperation({ summary: 'Open a count and snapshot system quantities' })
  create(
    @Body() body: { warehouseId: string; branchId: string; countType: CountType; productIds?: string[]; locationId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.counts.create(body, user);
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

  @Post('stock-adjustments')
  @RequirePermissions('inventory.adjustment.CREATE')
  adjust(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.adjust(body, user);
  }
}
