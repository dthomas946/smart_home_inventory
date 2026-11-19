import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { LabelScanController } from './label-scan.controller';
import { LabelScanService } from './label-scan.service';
import { MatterDclService } from './matter-dcl.service';

@Module({
  imports: [SettingsModule],
  controllers: [LabelScanController],
  providers: [LabelScanService, MatterDclService],
})
export class LabelScanModule {}
