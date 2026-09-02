import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExcursionDisposition, ReturnDisposition, ReturnType } from '@prisma/client';
import { ReturnsService } from './returns.service';
import { DisposalService } from './disposal.service';
import { ColdChainService } from '../coldchain/coldchain.service';
import { AuthenticatedUser, CurrentUser, Public, RequirePermissions } from '../../common/decorators';

@ApiTags('Quality, Returns & Cold Chain')
@Controller()
export class QualityController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly disposals: DisposalService,
    private readonly coldChain: ColdChainService,
  ) {}

  // ---- Returns ----

  @Get('returns')
  @RequirePermissions('quality.return.READ')
  listReturns(@Query() query: any) {
    return this.returns.findAll({
      type: query.type as ReturnType,
      branchId: query.branchId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('returns/:id')
  @RequirePermissions('quality.return.READ')
  getReturn(@Param('id') id: string) {
    return this.returns.findOne(id);
  }

  @Post('returns')
  @RequirePermissions('quality.return.CREATE')
  @ApiOperation({ summary: 'Record a return; stock comes back quarantined pending inspection' })
  createReturn(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.returns.create(body, user);
  }

  @Post('returns/:id/inspect')
  @RequirePermissions('quality.return.APPROVE')
  @ApiOperation({ summary: 'Record the inspection disposition per line' })
  inspect(
    @Param('id') id: string,
    @Body() body: { decisions: Array<{ itemId: string; disposition: ReturnDisposition; notes?: string }> },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.returns.inspect(id, body.decisions, user);
  }

  // ---- Disposal ----

  @Get('disposals')
  @RequirePermissions('quality.disposal.READ')
  listDisposals(@Query() query: any) {
    return this.disposals.findAll({
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Post('disposals')
  @RequirePermissions('quality.disposal.CREATE')
  createDisposal(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.disposals.create(body, user);
  }

  @Post('disposals/:id/approve')
  @RequirePermissions('quality.disposal.APPROVE')
  approveDisposal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.disposals.approve(id, user);
  }

  @Post('disposals/:id/execute')
  @RequirePermissions('quality.disposal.APPROVE')
  @ApiOperation({ summary: 'Carry out an approved disposal and record the certificate' })
  executeDisposal(
    @Param('id') id: string,
    @Body() body: { witnessName: string; certificateNo: string; certificateUrl?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disposals.execute(id, body, user);
  }

  // ---- Cold chain ----

  @Get('cold-chain/live')
  @RequirePermissions('quality.cold_chain.READ')
  @ApiOperation({ summary: 'Live sensor readings with excursion and staleness status' })
  live(@Query('warehouseId') warehouseId?: string) {
    return this.coldChain.liveReadings(warehouseId);
  }

  @Post('cold-chain/readings')
  @ApiOperation({
    summary: 'Sensor ingestion endpoint. Opens excursions and quarantines stock automatically.',
  })
  @RequirePermissions('quality.cold_chain.EDIT')
  reading(@Body() body: { sensorCode: string; temperature: number; humidity?: number; recordedAt?: string }) {
    return this.coldChain.recordReading(body);
  }

  @Get('cold-chain/excursions')
  @RequirePermissions('quality.cold_chain.READ')
  excursions(@Query() query: any) {
    return this.coldChain.listExcursions({
      disposition: query.disposition as ExcursionDisposition,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Post('cold-chain/excursions/:id/decide')
  @RequirePermissions('quality.cold_chain.APPROVE')
  @ApiOperation({ summary: 'QA disposition for an excursion; releasing requires an investigation note' })
  decide(
    @Param('id') id: string,
    @Body() body: { disposition: ExcursionDisposition; investigation: string; correctiveAction?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.coldChain.decideExcursion(id, body, user);
  }
}
