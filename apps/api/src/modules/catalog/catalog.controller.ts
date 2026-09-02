import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Drug Master')
@Controller('products')
export class CatalogController {
  constructor(private readonly products: ProductsService) {}

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

  @Get(':id')
  @RequirePermissions('catalog.product.READ')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
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
