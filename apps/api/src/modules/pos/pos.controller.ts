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

  @Post('hold')
  @RequirePermissions('sales.sale.CREATE')
  @ApiOperation({ summary: 'Park a cart, reserving its stock so another till cannot sell it' })
  hold(@Body() body: CheckoutInput, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.holdCart(body, user);
  }

  @Get('held')
  @RequirePermissions('sales.sale.READ')
  held(@Query('branchId') branchId: string) {
    return this.pos.listHeld(branchId);
  }

  @Post('held/:id/resume')
  @RequirePermissions('sales.sale.CREATE')
  @ApiOperation({ summary: 'Resume a held cart; releases its reservations and returns the lines' })
  resume(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.resumeCart(id, user);
  }

  @Post('held/:id/abandon')
  @RequirePermissions('sales.sale.CANCEL')
  abandon(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.abandonHeld(id, user);
  }

  @Post('sales/:id/refund')
  @RequirePermissions('sales.sale.CANCEL')
  @ApiOperation({ summary: 'Refund whole or part of a sale, returning stock to its original batches' })
  refund(
    @Param('id') id: string,
    @Body() body: { lines: Array<{ saleItemId: string; quantity: number }>; reason: string; method?: any },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.refund(id, body, user);
  }

  @Get('sales')
  @RequirePermissions('sales.sale.READ')
  @ApiOperation({ summary: 'Find a past sale to reprint, void or return against (§22)' })
  searchSales(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.searchSales(
      {
        q: query.q,
        branchId: query.branchId,
        patientId: query.patientId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 25,
      },
      user,
    );
  }

  @Get('today')
  @RequirePermissions('sales.sale.READ')
  @ApiOperation({ summary: "Today's takings and top sellers for a branch" })
  today(@Query('branchId') branchId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.todaySummary(branchId, user);
  }

  @Get('cash-sessions/:id/report')
  @RequirePermissions('sales.cash_session.READ')
  @ApiOperation({
    summary: 'Shift report (X mid-shift, Z after close). Reads only — it never closes anything.',
  })
  shiftReport(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.shiftReport(id, user);
  }

  @Post('cash-sessions/:id/movements')
  @RequirePermissions('sales.cash_session.EDIT')
  @ApiOperation({ summary: 'Record a drop, payout, pickup or float top-up (§46)' })
  cashMovement(
    @Param('id') id: string,
    @Body()
    body: {
      movementType: string;
      amount: number;
      reason: string;
      witnessedById?: string;
      reference?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.recordCashMovement({ ...body, cashSessionId: id }, user);
  }

  @Get('cash-sessions/current')
  @RequirePermissions('sales.cash_session.READ')
  currentSession(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId: string) {
    return this.pos.currentSession(user, branchId);
  }

  @Post('cash-sessions/open')
  @RequirePermissions('sales.cash_session.CREATE')
  openSession(
    @Body() body: { branchId: string; openingCash: number; isBlindClose?: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.openSession(body, user);
  }

  @Post('cash-sessions/:id/close')
  @RequirePermissions('sales.cash_session.EDIT')
  @ApiOperation({ summary: 'Reconcile and close a till; a material variance needs an explanation' })
  closeSession(
    @Param('id') id: string,
    @Body()
    body: {
      actualCash: number;
      varianceReason?: string;
      denominations?: Record<string, number>;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.closeSession(
      id,
      body.actualCash,
      user,
      body.varianceReason,
      body.denominations,
    );
  }
}
