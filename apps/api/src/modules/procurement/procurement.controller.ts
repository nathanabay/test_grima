import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';
import { ProcurementService } from './procurement.service';
import { SuppliersService } from './suppliers.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Procurement')
@Controller()
export class ProcurementController {
  constructor(
    private readonly procurement: ProcurementService,
    private readonly suppliers: SuppliersService,
  ) {}

  // ---- Suppliers ----

  @Get('suppliers')
  @RequirePermissions('procurement.supplier.READ')
  listSuppliers(@Query() query: any) {
    return this.suppliers.findAll({
      q: query.q,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('suppliers/performance')
  @RequirePermissions('procurement.supplier.READ')
  @ApiOperation({ summary: 'Supplier scorecard with delivery, quality and licence status' })
  performance() {
    return this.suppliers.performanceReport();
  }

  @Get('suppliers/:id')
  @RequirePermissions('procurement.supplier.READ')
  supplier(@Param('id') id: string) {
    return this.suppliers.findOne(id);
  }

  @Post('suppliers')
  @RequirePermissions('procurement.supplier.CREATE')
  createSupplier(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliers.create(body, user);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('procurement.supplier.EDIT')
  updateSupplier(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliers.update(id, body, user);
  }

  @Post('suppliers/recompute-scores')
  @RequirePermissions('procurement.supplier.EDIT')
  recomputeScores() {
    return this.suppliers.recomputeAllScores();
  }

  // ---- Replenishment ----

  @Get('replenishment/recommendations')
  @RequirePermissions('analytics.forecast.READ')
  @ApiOperation({
    summary: 'Reorder recommendations with the full calculation shown (§12) - advisory only',
  })
  replenishment(@Query('branchId') branchId?: string) {
    return this.procurement.replenishmentRecommendations(branchId);
  }

  // ---- Purchase requests ----

  @Post('purchase-requests')
  @RequirePermissions('procurement.purchase_request.CREATE')
  createPr(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.procurement.createPurchaseRequest(body, user);
  }

  @Post('purchase-requests/:id/decide')
  @RequirePermissions('procurement.purchase_request.APPROVE')
  decidePr(
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVE' | 'REJECT'; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurement.approvePurchaseRequest(id, body.decision, user, body.reason);
  }

  // ---- RFQ / quotations ----

  @Post('rfqs')
  @RequirePermissions('procurement.rfq.CREATE')
  createRfq(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.procurement.createRfq(body, user);
  }

  @Post('rfqs/:id/quotations')
  @RequirePermissions('procurement.quotation.CREATE')
  submitQuotation(@Param('id') id: string, @Body() body: any) {
    return this.procurement.submitQuotation(id, body);
  }

  @Get('rfqs/:id/comparison')
  @RequirePermissions('procurement.quotation.READ')
  @ApiOperation({ summary: 'Weighted quotation comparison with landed cost; never auto-selects' })
  compare(@Param('id') id: string, @Query() query: any) {
    return this.procurement.compareQuotations(id, {
      price: query.wPrice ? Number(query.wPrice) : undefined,
      deliveryTime: query.wDelivery ? Number(query.wDelivery) : undefined,
      shelfLife: query.wShelfLife ? Number(query.wShelfLife) : undefined,
      supplierScore: query.wSupplier ? Number(query.wSupplier) : undefined,
      paymentTerms: query.wTerms ? Number(query.wTerms) : undefined,
    });
  }

  // ---- Purchase orders ----

  @Get('purchase-orders')
  @RequirePermissions('procurement.purchase_order.READ')
  listPos(@Query() query: any) {
    return this.procurement.findPurchaseOrders({
      status: query.status as PurchaseOrderStatus,
      supplierId: query.supplierId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('procurement.purchase_order.READ')
  po(@Param('id') id: string) {
    return this.procurement.findPurchaseOrder(id);
  }

  @Post('purchase-orders')
  @RequirePermissions('procurement.purchase_order.CREATE')
  createPo(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.procurement.createPurchaseOrder(body, user);
  }

  @Post('purchase-orders/:id/transition')
  @RequirePermissions('procurement.purchase_order.APPROVE')
  @ApiOperation({ summary: 'Advance a PO through DRAFT -> ... -> APPROVED -> ORDERED' })
  transition(
    @Param('id') id: string,
    @Body() body: { status: PurchaseOrderStatus; comment?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurement.transitionPurchaseOrder(id, body.status, user, body.comment);
  }
}
