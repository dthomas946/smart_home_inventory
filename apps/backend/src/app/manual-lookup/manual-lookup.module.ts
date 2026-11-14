import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ManualLookupController } from './manual-lookup.controller';
import { ManualLookupService } from './manual-lookup.service';

@Module({
  imports: [AttachmentsModule],
  controllers: [ManualLookupController],
  providers: [ManualLookupService],
})
export class ManualLookupModule {}
