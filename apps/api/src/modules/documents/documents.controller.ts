import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  DocumentsStoreService,
  DocumentEntityType,
  UploadedFileLike,
} from './documents-store.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsStoreService) {}

  @Post()
  @RequirePermissions('catalog.product.EDIT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a document to a supplier, product, prescription, recall or disposal' })
  upload(
    @UploadedFile() file: UploadedFileLike,
    @Body() body: { entityType: DocumentEntityType; entityId: string; expiresAt?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.upload(file, body, user);
  }

  @Get()
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Documents attached to one record' })
  list(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.documents.list(entityType, entityId);
  }

  @Get('expiring')
  @RequirePermissions('procurement.supplier.READ')
  @ApiOperation({ summary: 'Licences and certificates that expire soon (§44)' })
  expiring(@Query('withinDays') withinDays?: string) {
    return this.documents.expiring(withinDays ? Number(withinDays) : 60);
  }

  @Get(':id/content')
  @RequirePermissions('catalog.product.READ')
  @ApiOperation({ summary: 'Download or inline-view the stored file' })
  async content(@Param('id') id: string, @Res() res: Response) {
    const { doc, stream } = await this.documents.stream(id);
    res.header('Content-Type', doc.mimeType);
    // Images render inline; everything else downloads under its original name.
    res.header(
      'Content-Disposition',
      `${doc.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${doc.fileName}"`,
    );
    stream.pipe(res);
  }

  @Delete(':id')
  @RequirePermissions('catalog.product.DELETE')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.remove(id, user);
  }
}
