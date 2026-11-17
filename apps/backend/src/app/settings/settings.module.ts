import { Module } from '@nestjs/common';
import { HaModule } from '../ha/ha.module';
import { AiSettingsService } from './ai-settings.service';
import { RegionSettingsService } from './region-settings.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [HaModule],
  controllers: [SettingsController],
  providers: [SettingsService, AiSettingsService, RegionSettingsService],
  exports: [SettingsService, AiSettingsService, RegionSettingsService],
})
export class SettingsModule {}
