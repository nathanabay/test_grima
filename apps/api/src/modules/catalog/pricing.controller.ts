import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { ProductDepthService } from './product-depth.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Pricing')
@Controller()
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly depth: ProductDepthService,
  ) {}

  // ---- Price lists ----

  @Get('price-lists')
  @RequirePermissions('catalog.price.READ')
  list(@Query() query: any) {
    return this.pricing.listPriceLists({ listType: query.listType, branchId: query.branchId });
  }

  @Get('price-lists/:id')
  @RequirePermissions('catalog.price.READ')
  get(@Param('id') id: string) {
    return this.pricing.getPriceList(id);
  }

  @Post('price-lists')
  @RequirePermissions('catalog.price.EDIT')
  create(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.createPriceList(body, user);
  }

  @Patch('price-lists/:id')
  @RequirePermissions('catalog.price.EDIT')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.updatePriceList(id, body, user);
  }

  @Post('price-lists/:id/items')
  @RequirePermissions('catalog.price.EDIT')
  @ApiOperation({ summary: 'Set a product price on a list; writes a price-history row' })
  setPrice(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.setPrice(id, body, user);
  }

  @Delete('price-lists/items/:itemId')
  @RequirePermissions('catalog.price.EDIT')
  removePrice(@Param('itemId') itemId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.removePrice(itemId, user);
  }

  @Post('price-lists/quote')
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Resolve prices for a basket in one call' })
  quote(@Body() body: { productIds: string[]; branchId?: string; customerGroupId?: string; patientId?: string; channel?: any; quantity?: number }) {
    return this.pricing
      .resolveMany(body.productIds ?? [], {
        branchId: body.branchId,
        customerGroupId: body.customerGroupId,
        patientId: body.patientId,
        channel: body.channel,
        quantity: body.quantity,
      })
      .then((map) => Object.fromEntries(map));
  }

  // ---- Customer groups ----

  @Get('customer-groups')
  @RequirePermissions('sales.patient.READ')
  groups() {
    return this.pricing.listCustomerGroups();
  }

  @Post('customer-groups')
  @RequirePermissions('sales.patient.CREATE')
  createGroup(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.createCustomerGroup(body, user);
  }

  @Patch('customer-groups/:id')
  @RequirePermissions('sales.patient.EDIT')
  updateGroup(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.updateCustomerGroup(id, body, user);
  }

  // ---- Product attribute definitions ----

  @Get('attribute-definitions')
  @RequirePermissions('catalog.product.READ')
  attributeDefinitions(@Query('includeInactive') includeInactive?: string) {
    return this.depth.listAttributeDefinitions(includeInactive === 'true');
  }

  @Post('attribute-definitions')
  @RequirePermissions('catalog.product.CREATE')
  @ApiOperation({ summary: 'Define an extra field that every product can carry' })
  createAttributeDefinition(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.depth.createAttributeDefinition(body, user);
  }
}
