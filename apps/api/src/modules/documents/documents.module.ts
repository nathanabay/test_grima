import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsStoreService } from './documents-store.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsStoreService],
  exports: [DocumentsStoreService],
})
export class DocumentsModule {}
