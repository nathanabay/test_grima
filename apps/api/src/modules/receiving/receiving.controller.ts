import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReceivingService, ReceiveInput } from './receiving.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Goods Receiving')
@Controller('goods-receipts')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Get()
  @RequirePermissions('inventory.goods_receipt.READ')
  list(@Query() query: any) {
    return this.receiving.findAll({
      warehouseId: query.warehouseId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get(':id')
  @RequirePermissions('inventory.goods_receipt.READ')
  findOne(@Param('id') id: string) {
    return this.receiving.findOne(id);
  }

  @Post()
  @RequirePermissions('inventory.goods_receipt.CREATE')
  @ApiOperation({
    summary:
      'Receive goods: creates quarantined batches, posts stock in, and flags receiving exceptions',
  })
  receive(@Body() body: ReceiveInput, @CurrentUser() user: AuthenticatedUser) {
    return this.receiving.receive(body, user);
  }
}
