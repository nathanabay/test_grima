import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PosService, CheckoutInput } from './pos.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Point of Sale')
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('search')
  @RequirePermissions('sales.sale.CREATE')
  @ApiOperation({ summary: 'Product search with live availability for the till' })
  search(@Query() query: any) {
    return this.pos.searchForSale({
      q: query.q ?? '',
      warehouseId: query.warehouseId,
      limit: query.limit ? Number(query.limit) : 20,
    });
  }

  @Post('checkout')
  @RequirePermissions('sales.sale.CREATE')
  @ApiOperation({ summary: 'Complete a sale: FEFO allocation, stock movement and payment in one transaction' })
  checkout(@Body() body: CheckoutInput, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.checkout(body, user);
  }

  @Get('sales/:id')
  @RequirePermissions('sales.sale.READ')
  sale(@Param('id') id: string) {
    return this.pos.findOne(id);
  }

  @Post('sales/:id/void')
  @RequirePermissions('sales.sale.CANCEL')
  voidSale(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.voidSale(id, body.reason, user);
  }

  @Post('cash-sessions/open')
  @RequirePermissions('sales.cash_session.CREATE')
  openSession(@Body() body: { branchId: string; openingCash: number }, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.openSession(body, user);
  }

  @Post('cash-sessions/:id/close')
  @RequirePermissions('sales.cash_session.EDIT')
  @ApiOperation({ summary: 'Reconcile and close a till; a material variance needs an explanation' })
  closeSession(
    @Param('id') id: string,
    @Body() body: { actualCash: number; varianceReason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.closeSession(id, body.actualCash, user, body.varianceReason);
  }
}
