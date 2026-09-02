import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { QualityIncidentStatus, QualityIncidentType } from '@prisma/client';
import { IncidentsService, CreateIncidentInput, EvidenceInput } from './incidents.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Quality Incidents & CAPA')
@Controller('quality-incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @RequirePermissions('quality.incident.READ')
  list(@Query() query: any) {
    return this.incidents.findAll({
      status: query.status as QualityIncidentStatus,
      type: query.type as QualityIncidentType,
      supplierId: query.supplierId,
      openOnly: query.openOnly === 'true',
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('summary')
  @RequirePermissions('quality.incident.READ')
  @ApiOperation({ summary: 'CAPA summary: counts per stage, average time to close, overdue incidents' })
  summary() {
    return this.incidents.summary();
  }

  @Get(':id')
  @RequirePermissions('quality.incident.READ')
  findOne(@Param('id') id: string) {
    return this.incidents.findOne(id);
  }

  @Post()
  @RequirePermissions('quality.incident.CREATE')
  @ApiOperation({ summary: 'Report a quality incident, optionally quarantining the batch it concerns' })
  create(@Body() body: CreateIncidentInput, @CurrentUser() user: AuthenticatedUser) {
    return this.incidents.create(body, user);
  }

  @Post(':id/advance')
  @RequirePermissions('quality.incident.EDIT')
  @ApiOperation({
    summary:
      'Advance the CAPA workflow. Each step must supply its own evidence: root cause, ' +
      'corrective action, preventive action, then verification.',
  })
  advance(
    @Param('id') id: string,
    @Body()
    body: EvidenceInput & { status: QualityIncidentStatus; closureNote?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { status, closureNote, ...evidence } = body;
    return this.incidents.advance(id, status, evidence, user, closureNote);
  }

  @Post(':id/assign')
  @RequirePermissions('quality.incident.EDIT')
  assign(
    @Param('id') id: string,
    @Body() body: { assignedToId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.assign(id, body.assignedToId, user);
  }
}
