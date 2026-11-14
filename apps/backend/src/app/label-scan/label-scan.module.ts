import { Module } from '@nestjs/common';
import { LabelScanController } from './label-scan.controller';
import { LabelScanService } from './label-scan.service';

@Module({
  controllers: [LabelScanController],
  providers: [LabelScanService],
})
export class LabelScanModule {}
