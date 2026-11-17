import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  AiSettingsDto,
  AiSettingsSchema,
  AiTestResultDto,
  RegionSettingsDto,
  RegionSettingsSchema,
} from '@smart-home-inventory/shared';
import { zodPipe } from '../common/zod-validation.pipe';
import { AiSettingsService } from './ai-settings.service';
import { RegionSettingsService } from './region-settings.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly ai: AiSettingsService,
    private readonly region: RegionSettingsService
  ) {}

  /** AI provider for Scan label. The API key is never returned. */
  @Get('ai')
  getAi() {
    return this.ai.view();
  }

  @Put('ai')
  saveAi(@Body(zodPipe(AiSettingsSchema)) dto: AiSettingsDto) {
    return this.ai.save(dto);
  }

  /** Check the *submitted* settings (not yet saved) can reach the provider. */
  @Post('ai/test')
  async testAi(@Body(zodPipe(AiSettingsSchema)) dto: AiSettingsDto): Promise<AiTestResultDto> {
    const current = await this.ai.get();
    const merged: AiSettingsDto = {
      ...dto,
      openai: { ...dto.openai, apiKey: dto.openai.apiKey === null ? current.openai.apiKey : dto.openai.apiKey },
    };
    const provider = this.ai.provider(merged);
    if (!provider) {
      return {
        ok: false,
        message: merged.provider === 'none' ? 'AI is turned off.' : 'Fill in the required fields first.',
      };
    }
    return provider.test();
  }

  /** ai_task.* entities in Home Assistant, for the picker. */
  @Get('ai/ha-entities')
  aiTaskEntities() {
    return this.ai.aiTaskEntities();
  }

  @Get('region')
  getRegion() {
    return this.region.effective();
  }

  @Put('region')
  saveRegion(@Body(zodPipe(RegionSettingsSchema)) dto: RegionSettingsDto) {
    return this.region.save(dto);
  }
}
