import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BackupService } from './backup.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Backup & Recovery')
@Controller('admin/backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  @RequirePermissions('admin.backup.READ')
  @ApiOperation({ summary: 'Last successful backup, next scheduled run, and overall health' })
  status() {
    return this.backups.status();
  }

  @Post()
  @RequirePermissions('admin.backup.CREATE')
  @ApiOperation({ summary: 'Take an encrypted backup now' })
  run(@CurrentUser() user: AuthenticatedUser) {
    return this.backups.run('MANUAL', user);
  }

  @Post(':id/verify')
  @RequirePermissions('admin.backup.READ')
  @ApiOperation({ summary: 'Decrypt end to end to prove the backup is restorable' })
  verify(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.backups.verify(id, user);
  }

  @Post(':id/decrypt')
  @RequirePermissions('admin.backup.CREATE')
  @ApiOperation({
    summary:
      'Decrypt a backup to a local file for restore. Restoring itself is an operator action ' +
      'performed at the console with the service stopped — it is deliberately not exposed here.',
  })
  decrypt(
    @Param('id') id: string,
    @Body() body: { targetPath: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.backups.decryptToFile(id, body.targetPath, user);
  }
}
