import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [CatalogController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class CatalogModule {}
