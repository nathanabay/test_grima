import { Global, Module } from '@nestjs/common';
import { SeparationOfDutiesService } from './separation.service';

/**
 * Global, because separation of duties is a property of the product rather
 * than of one module: every chain that has an approver needs the same rule.
 */
@Global()
@Module({
  providers: [SeparationOfDutiesService],
  exports: [SeparationOfDutiesService],
})
export class ApprovalModule {}
