import { Global, Module } from '@nestjs/common';
import { DocumentNumberService } from './document-number.service';
import { ScopeService } from '../../common/guards/scope.service';

@Global()
@Module({
  providers: [DocumentNumberService, ScopeService],
  exports: [DocumentNumberService, ScopeService],
})
export class CommonServicesModule {}
