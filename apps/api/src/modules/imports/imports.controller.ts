import { Body, Controller, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImportsService } from './imports.service';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators';

@ApiTags('Import')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('catalogue')
  @ApiOperation({ summary: 'What can be imported, and the fields each import expects' })
  catalogue(@CurrentUser() user: AuthenticatedUser) {
    return this.imports.catalogue(user);
  }

  @Get('template/:entityType')
  @Header('content-type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'A CSV template with an example row and per-column notes' })
  template(@Param('entityType') entityType: string, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.template(entityType, user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('entityType') entityType?: string) {
    return this.imports.list(user, entityType);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.get(id, user);
  }

  @Post('upload')
  @ApiOperation({
    summary: 'Upload a CSV. Columns are matched to fields automatically where the names line up.',
  })
  upload(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.upload(body, user);
  }

  @Patch(':id/mapping')
  @ApiOperation({ summary: 'Change how uploaded columns map to fields' })
  remap(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.remap(id, body.mapping ?? {}, user);
  }

  @Post(':id/validate')
  @ApiOperation({ summary: 'Check every row and summarise what is wrong. Writes nothing.' })
  validate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.validate(id, user);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'What would be imported and what would be rejected' })
  preview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.imports.preview(id, user, limit ? Number(limit) : 20);
  }

  @Post(':id/apply')
  @ApiOperation({ summary: 'Apply the valid rows' })
  apply(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.apply(id, user);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: 'Undo the records this import created' })
  rollback(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.rollback(id, body?.reason, user);
  }

  @Get(':id/errors.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="import-errors.csv"')
  @ApiOperation({ summary: 'The rows that failed, with their errors, ready to correct and re-upload' })
  errors(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.errorFile(id, user);
  }
}
