import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SerialsService } from './serials.service';
import { SERIAL_EVENT_TYPES, SERIAL_STATUSES } from './serial.state';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Serial Numbers')
@Controller('serials')
export class SerialsController {
  constructor(private readonly serials: SerialsService) {}

  @Get('vocabulary')
  @RequirePermissions('inventory.serial.READ')
  @ApiOperation({ summary: 'The statuses and events the serial register recognises' })
  vocabulary() {
    return { statuses: SERIAL_STATUSES, eventTypes: SERIAL_EVENT_TYPES };
  }

  @Get()
  @RequirePermissions('inventory.serial.READ')
  @ApiOperation({ summary: 'Serial register (§3: feature 141)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.serials.findAll(user, {
      serial: query.serial,
      batchId: query.batchId,
      productId: query.productId,
      status: query.status,
      warehouseId: query.warehouseId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get('summary')
  @RequirePermissions('inventory.serial.READ')
  summary(@Query() query: any) {
    return this.serials.summary({ batchId: query.batchId, productId: query.productId });
  }

  @Get('by-serial/:serial')
  @RequirePermissions('inventory.serial.READ')
  @ApiOperation({ summary: 'Resolve the code printed on a pack to its full history' })
  bySerial(@Param('serial') serial: string, @CurrentUser() user: AuthenticatedUser) {
    return this.serials.findBySerial(serial, user);
  }

  @Get(':id')
  @RequirePermissions('inventory.serial.READ')
  @ApiOperation({ summary: 'Serial history: every movement, in order (§3: feature 149)' })
  history(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.serials.history(id, user);
  }

  @Post('import')
  @RequirePermissions('inventory.serial.IMPORT')
  @ApiOperation({ summary: 'Register the serials delivered with a batch (§3: feature 148)' })
  import(
    @Body()
    body: {
      batchId: string;
      serials: string[];
      warehouseId?: string;
      referenceType?: string;
      referenceId?: string;
      referenceNo?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serials.importSerials(body.batchId, body.serials ?? [], user, {
      warehouseId: body.warehouseId,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      referenceNo: body.referenceNo,
    });
  }

  @Post(':id/events')
  @RequirePermissions('inventory.serial.EDIT')
  @ApiOperation({
    summary: 'Record a movement against one pack; refused if the lifecycle does not allow it',
  })
  event(
    @Param('id') id: string,
    @Body()
    body: {
      eventType: string;
      referenceType?: string;
      referenceId?: string;
      referenceNo?: string;
      warehouseId?: string;
      branchId?: string;
      reason?: string;
      correctedTo?: string;
      occurredAt?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serials.recordEvent(
      id,
      { ...body, occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined },
      user,
    );
  }

  @Post('batches/:batchId/recall')
  @RequirePermissions('quality.recall.CREATE')
  @ApiOperation({ summary: 'Mark every reachable pack of a batch recalled (§3: feature 147)' })
  recallBatch(
    @Param('batchId') batchId: string,
    @Body() body: { reason: string; referenceNo?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serials.recallBatch(batchId, user, body.reason, body.referenceNo);
  }
}
