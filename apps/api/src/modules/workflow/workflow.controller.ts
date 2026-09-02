import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkflowService, WorkflowStep, StartWorkflowInput } from './workflow.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Approval Workflows')
@Controller('workflows')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get('definitions')
  @RequirePermissions('admin.setting.READ')
  definitions() {
    return this.workflow.listDefinitions();
  }

  @Post('definitions')
  @RequirePermissions('admin.setting.EDIT')
  @ApiOperation({
    summary:
      'Create or replace an approval chain. Steps may be conditional on amount, branch ' +
      'or whether the document involves a controlled medicine.',
  })
  upsert(
    @Body()
    body: { code: string; name: string; documentType: string; steps: WorkflowStep[]; isActive?: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflow.upsertDefinition(body, user);
  }

  @Post('preview')
  @RequirePermissions('admin.setting.READ')
  @ApiOperation({ summary: 'Which steps would apply to a document with these attributes' })
  preview(@Body() body: StartWorkflowInput) {
    return this.workflow.applicableSteps(body);
  }

  @Get('queue')
  @ApiOperation({ summary: 'Documents waiting on the current user, across every document type' })
  queue(@CurrentUser() user: AuthenticatedUser) {
    return this.workflow.myQueue(user);
  }

  @Get('status')
  @ApiOperation({ summary: 'Approval progress for one document' })
  status(@Query('documentType') documentType: string, @Query('documentId') documentId: string) {
    return this.workflow.status(documentType, documentId);
  }

  @Post('start')
  @ApiOperation({ summary: 'Submit a document into its configured approval chain' })
  start(@Body() body: StartWorkflowInput, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.start(body, user);
  }

  @Post('act')
  @ApiOperation({
    summary:
      'Approve, reject or return a document. The step decides which permission is required, ' +
      'and one person cannot approve two steps of the same document.',
  })
  act(
    @Body()
    body: {
      documentType: string;
      documentId: string;
      action: 'APPROVE' | 'REJECT' | 'RETURN';
      comment?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflow.act(body.documentType, body.documentId, body.action, user, body.comment);
  }
}
