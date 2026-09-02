import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';
import { TransfersService } from './transfers.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Stock Transfers')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @RequirePermissions('inventory.transfer.READ')
  list(@Query() query: any) {
    return this.transfers.findAll({
      status: query.status as TransferStatus,
      warehouseId: query.warehouseId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get(':id')
  @RequirePermissions('inventory.transfer.READ')
  findOne(@Param('id') id: string) {
    return this.transfers.findOne(id);
  }

  @Post()
  @RequirePermissions('inventory.transfer.CREATE')
  create(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.create(body, user);
  }

  @Post(':id/submit')
  @RequirePermissions('inventory.transfer.CREATE')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.submit(id, user);
  }

  @Post(':id/approve')
  @RequirePermissions('inventory.transfer.APPROVE')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.approve(id, user);
  }

  @Post(':id/dispatch')
  @RequirePermissions('inventory.transfer.EDIT')
  @ApiOperation({ summary: 'Dispatch stock out of the origin warehouse (supports partial shipment)' })
  dispatch(
    @Param('id') id: string,
    @Body() body: { lines: Array<{ itemId: string; quantity: number }>; vehicleOrCourier?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transfers.dispatch(id, body.lines, user, body.vehicleOrCourier);
  }

  @Post(':id/receive')
  @RequirePermissions('inventory.transfer.EDIT')
  @ApiOperation({ summary: 'Receive stock at the destination; shortfalls require a variance reason' })
  receive(
    @Param('id') id: string,
    @Body() body: { lines: Array<{ itemId: string; quantity: number; varianceReason?: string }> },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transfers.receive(id, body.lines, user);
  }
}
