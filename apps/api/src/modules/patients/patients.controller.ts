import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
}
