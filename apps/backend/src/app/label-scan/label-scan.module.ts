import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { LabelScanController } from './label-scan.controller';
import { LabelScanService } from './label-scan.service';

@Module({
  imports: [SettingsModule],
  controllers: [LabelScanController],
  providers: [LabelScanService],
})
export class LabelScanModule {}
