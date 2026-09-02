import { Module } from '@nestjs/common';
import { SerialsController } from './serials.controller';
import { SerialsService } from './serials.service';

@Module({
  controllers: [SerialsController],
  providers: [SerialsService],
  exports: [SerialsService],
})
export class SerialsModule {}
