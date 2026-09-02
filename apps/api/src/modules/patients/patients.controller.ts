import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Patients & Customers')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @RequirePermissions('sales.patient.READ')
  search(@Query() query: any, @CurrentUser() user: AuthenticatedUser) {
    return this.patients.search(
      {
        q: query.q,
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 25,
      },
      user,
    );
  }

  @Get('duplicates')
  @RequirePermissions('sales.patient.READ')
  @ApiOperation({ summary: 'Candidate duplicate records for review; nothing is merged automatically (§14)' })
  duplicates(@Query('limit') limit?: string) {
    return this.patients.findDuplicates(limit ? Number(limit) : 50);
  }

  @Get('retention-candidates')
  @RequirePermissions('sales.patient.DELETE')
  @ApiOperation({ summary: 'Dormant records eligible for anonymisation under the retention policy (§14)' })
  retention(@Query('years') years?: string) {
    return this.patients.retentionCandidates(years ? Number(years) : 7);
  }

  @Get(':id')
  @RequirePermissions('sales.patient.READ')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patients.findOne(id, user);
  }

  @Get(':id/history')
  @RequirePermissions('dispensing.dispensing.READ')
  history(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patients.history(id, user);
  }

  @Post()
  @RequirePermissions('sales.patient.CREATE')
  create(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.patients.create(body, user);
  }

  @Patch(':id')
  @RequirePermissions('sales.patient.EDIT')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.patients.update(id, body, user);
  }

  @Post(':id/merge')
  @RequirePermissions('sales.patient.EDIT', 'sales.patient.DELETE')
  @ApiOperation({
    summary:
      'Merge this duplicate into the surviving record; history is repointed and the duplicate is kept (§14)',
  })
  merge(
    @Param('id') id: string,
    @Body() body: { targetId: string; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patients.merge(id, body.targetId, user, body.reason);
  }

  @Post(':id/anonymize')
  @RequirePermissions('sales.patient.DELETE')
  @ApiOperation({ summary: 'Clear the identifying fields while keeping the pharmacy record (§14)' })
  anonymize(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patients.anonymize(id, body?.reason, user);
  }
}
