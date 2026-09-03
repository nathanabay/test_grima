import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { ProductDepthService } from './product-depth.service';
import { PricingService } from './pricing.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Drug Master')
@Controller('products')
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly depth: ProductDepthService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Search the drug master by name, brand, SKU, GTIN or barcode' })
  search(@Query() query: any) {
    return this.products.search({
      q: query.q,
      categoryId: query.categoryId,
      isControlled: query.isControlled === undefined ? undefined : query.isControlled === 'true',
      isActive: query.isActive === undefined ? true : query.isActive === 'true',
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('categories')
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Every product category, for the filters that use one' })
  categories() {
    return this.products.categories();
  }

  @Get('by-ingredient')
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Find products containing an active ingredient' })
  byIngredient(@Query('name') name: string, @Query('limit') limit?: string) {
    return this.depth.searchByIngredient(name ?? '', limit ? Number(limit) : 50);
  }

  @Get(':id')
  @RequirePermissions('catalog.product.READ')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  // ---- Ingredients (§1: features 4-7) ----

  @Get(':id/ingredients')
  @RequirePermissions('catalog.product.READ')
  ingredients(@Param('id') id: string) {
    return this.depth.listIngredients(id);
  }

  @Patch(':id/ingredients')
  @RequirePermissions('catalog.product.EDIT')
  @ApiOperation({ summary: 'Replace the ingredient list of a combination product' })
  setIngredients(
    @Param('id') id: string,
    @Body() body: { ingredients: any[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.depth.setIngredients(id, body.ingredients ?? [], user);
  }

  // ---- Relationships (§1: features 30-34) ----

  @Get(':id/relations')
  @RequirePermissions('catalog.product.READ')
  relations(@Param('id') id: string) {
    return this.depth.listRelations(id);
  }

  @Post(':id/relations')
  @RequirePermissions('catalog.product.EDIT')
  addRelation(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.depth.addRelation(id, body, user);
  }

  @Delete('relations/:relationId')
  @RequirePermissions('catalog.product.EDIT')
  removeRelation(
    @Param('relationId') relationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.depth.removeRelation(relationId, user);
  }

  @Get(':id/substitutes')
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Related products that are active and in sellable stock' })
  substitutes(@Param('id') id: string, @Query('branchId') branchId?: string) {
    return this.depth.availableSubstitutes(id, branchId);
  }

  // ---- Custom attributes (§1: feature 49) ----

  @Get(':id/attributes')
  @RequirePermissions('catalog.product.READ')
  attributes(@Param('id') id: string) {
    return this.depth.listAttributes(id);
  }

  @Patch(':id/attributes')
  @RequirePermissions('catalog.product.EDIT')
  setAttributes(
    @Param('id') id: string,
    @Body() body: { values: Record<string, string> },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.depth.setAttributes(id, body.values ?? {}, user);
  }

  // ---- Pricing (§2: features 91-100) ----

  @Get(':id/price')
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Resolve the effective price, with the reasoning behind it' })
  price(@Param('id') id: string, @Query() query: any) {
    return this.pricing.resolve({
      productId: id,
      quantity: query.quantity ? Number(query.quantity) : 1,
      branchId: query.branchId,
      customerGroupId: query.customerGroupId,
      patientId: query.patientId,
      channel: query.channel,
    });
  }

  @Get(':id/price-history')
  @RequirePermissions('catalog.price.READ')
  priceHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.pricing.priceHistory(id, limit ? Number(limit) : 100);
  }

  @Post()
  @RequirePermissions('catalog.product.CREATE')
  create(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.products.create(body, user);
  }

  @Patch(':id')
  @RequirePermissions('catalog.product.EDIT')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.products.update(id, body, user);
  }

  @Post('import')
  @RequirePermissions('catalog.product.IMPORT')
  @ApiOperation({ summary: 'Validate-then-import product rows; rejects the whole file on any error' })
  import(@Body() body: { rows: any[] }, @CurrentUser() user: AuthenticatedUser) {
    return this.products.importProducts(body.rows ?? [], user);
  }
}
