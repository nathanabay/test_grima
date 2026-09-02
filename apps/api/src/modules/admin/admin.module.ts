import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PermissionSyncService } from './permission-sync.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, PermissionSyncService],
  exports: [AdminService, PermissionSyncService],
})
export class AdminModule {}
