import { Global, Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ApiKeysService } from './api-keys.service';

/** Global: any domain module can publish an event without importing a provider. */
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ApiKeysService],
  exports: [IntegrationsService, ApiKeysService],
})
export class IntegrationsModule {}
