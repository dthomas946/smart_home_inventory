import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AttachFromUrlDto,
  AttachFromUrlSchema,
  ManualSearchQueryDto,
  ManualSearchQuerySchema,
} from '@smart-home-inventory/shared';
import { zodPipe } from '../common/zod-validation.pipe';
import { ManualLookupService } from './manual-lookup.service';

@Controller('devices/:deviceId')
export class ManualLookupController {
  constructor(private readonly lookup: ManualLookupService) {}

  /** Search the web for this device's manual. Ephemeral — nothing is stored. */
  @Get('manual-candidates')
  search(
    @Param('deviceId') deviceId: string,
    @Query(zodPipe(ManualSearchQuerySchema)) query: ManualSearchQueryDto
  ) {
    return this.lookup.search(deviceId, query.q);
  }

  /** Fetch a URL server-side and file it as an attachment on this device. */
  @Post('attachments/from-url')
  attachFromUrl(
    @Param('deviceId') deviceId: string,
    @Body(zodPipe(AttachFromUrlSchema)) dto: AttachFromUrlDto
  ) {
    return this.lookup.attachFromUrl(deviceId, dto);
  }
}
