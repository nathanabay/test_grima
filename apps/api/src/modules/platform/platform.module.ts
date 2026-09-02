import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { HealthService } from './health.service';
import { OrgHierarchyService } from './org-hierarchy.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [PlatformController],
  providers: [HealthService, OrgHierarchyService],
  exports: [HealthService, OrgHierarchyService],
})
export class PlatformModule {}
