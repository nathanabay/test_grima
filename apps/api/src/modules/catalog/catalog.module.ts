import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { PricingController } from './pricing.controller';
import { ProductsService } from './products.service';
import { ProductDepthService } from './product-depth.service';
import { PricingService } from './pricing.service';

@Module({
  controllers: [CatalogController, PricingController],
  providers: [ProductsService, ProductDepthService, PricingService],
  exports: [ProductsService, ProductDepthService, PricingService],
})
export class CatalogModule {}
