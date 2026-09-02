import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RecallStatus, RecallTaskStatus } from '@prisma/client';
import { RecallsService, CreateRecallInput } from './recalls.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Recalls')
@Controller('recalls')
export class RecallsController {
  constructor(private readonly recalls: RecallsService) {}

  @Get()
  @RequirePermissions('quality.recall.READ')
  list(@Query() query: any) {
    return this.recalls.findAll({
      status: query.status as RecallStatus,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get(':id')
  @RequirePermissions('quality.recall.READ')
  @ApiOperation({ summary: 'Recall dashboard: affected, in stock, dispensed, recovered, outstanding' })
  dashboard(@Param('id') id: string) {
    return this.recalls.dashboard(id);
  }

  @Post()
  @RequirePermissions('quality.recall.CREATE')
  @ApiOperation({
    summary: 'Activate a recall: blocks affected batches and generates recovery tasks immediately',
  })
  activate(@Body() body: CreateRecallInput, @CurrentUser() user: AuthenticatedUser) {
    return this.recalls.activate(body, user);
  }

  @Get('batches/:batchId/trace')
  @RequirePermissions('quality.recall.READ')
  @ApiOperation({ summary: 'Full genealogy: where the batch is now and who received it' })
  trace(@Param('batchId') batchId: string) {
    return this.recalls.traceBatch(batchId);
  }

  @Post('tasks/:taskId')
  @RequirePermissions('quality.recall.EDIT')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() body: { status: RecallTaskStatus; quantityRecovered?: number; notes?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recalls.updateTask(taskId, body, user);
  }

  @Post(':id/close')
  @RequirePermissions('quality.recall.APPROVE')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recalls.close(id, user);
  }
}
