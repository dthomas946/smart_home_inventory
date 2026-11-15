import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CreateSyncExclusionDto, CreateSyncExclusionSchema } from '@smart-home-inventory/shared';
import { zodPipe } from '../common/zod-validation.pipe';
import { HaCapabilitySuggestionsService } from './ha-capability-suggestions.service';
import { HaExclusionsService } from './ha-exclusions.service';
import { HaSyncService } from './ha-sync.service';

@Controller('ha')
export class HaController {
  constructor(
    private readonly haSync: HaSyncService,
    private readonly haCapabilitySuggestions: HaCapabilitySuggestionsService,
    private readonly exclusions: HaExclusionsService
  ) {}

  /** Rules, what they currently exclude, and pickers for adding more. */
  @Get('exclusions')
  listExclusions() {
    return this.exclusions.overview();
  }

  /** Add a rule, then sync so matching devices leave the inventory now. */
  @Post('exclusions')
  async addExclusion(@Body(zodPipe(CreateSyncExclusionSchema)) dto: CreateSyncExclusionDto) {
    await this.exclusions.add(dto);
    const sync = await this.haSync.sync();
    return { sync };
  }

  /** Remove a rule, then sync so those devices come back. */
  @Delete('exclusions/:id')
  async removeExclusion(@Param('id') id: string) {
    await this.exclusions.remove(id);
    const sync = await this.haSync.sync();
    return { sync };
  }

  /** Exclude one synced device (device page) and remove it now. */
  @Post('exclusions/device/:deviceId')
  excludeDevice(@Param('deviceId') deviceId: string) {
    return this.exclusions.excludeLocalDevice(deviceId);
  }

  @Post('sync')
  sync() {
    return this.haSync.sync();
  }

  @Get('status')
  status() {
    return this.haSync.status();
  }

  @Get('capability-suggestions')
  capabilitySuggestions(@Query('deviceId') deviceId?: string) {
    if (!deviceId?.trim()) return null;
    return this.haCapabilitySuggestions.forDevice(deviceId);
  }
}
