import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildGs1 } from '@pharmacore/shared';
import { ScanningService } from './scanning.service';
import { RequirePermissions } from '../../common/decorators';

@ApiTags('Scanning')
@Controller('scan')
export class ScanningController {
  constructor(private readonly scanning: ScanningService) {}

  @Post()
  @RequirePermissions('inventory.balance.READ')
  @ApiOperation({
    summary: 'Resolve a scanned barcode or GS1 DataMatrix to product, batch, expiry and serial',
  })
  scan(@Body() body: { code: string }) {
    return this.scanning.resolve(body.code);
  }

  @Post('encode')
  @RequirePermissions('inventory.batch.READ')
  @ApiOperation({ summary: 'Build a GS1 element string for label printing (§62)' })
  encode(@Body() body: { gtin: string; batchNumber?: string; expiryDate?: string; serialNumber?: string }) {
    const encoded = buildGs1({
      gtin: body.gtin,
      batchNumber: body.batchNumber,
      serialNumber: body.serialNumber,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
    });
    // Render the separator visibly so the value survives JSON round-tripping.
    return { encoded, humanReadable: encoded.replace(/\x1D/g, '<GS>') };
  }
}
