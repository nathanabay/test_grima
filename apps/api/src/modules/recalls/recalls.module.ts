import { Module } from '@nestjs/common';
import { RecallsController } from './recalls.controller';
import { RecallsService } from './recalls.service';

@Module({
  controllers: [RecallsController],
  providers: [RecallsService],
  exports: [RecallsService],
})
export class RecallsModule {}
