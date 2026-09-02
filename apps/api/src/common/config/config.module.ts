import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

/**
 * Global so any domain service can read a configured threshold without the
 * module graph having to thread it through (§65).
 */
@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class AppConfigModule {}
