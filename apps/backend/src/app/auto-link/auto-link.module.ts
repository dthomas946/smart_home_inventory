import { Module } from '@nestjs/common';
import { ConnectionTypesModule } from '../connection-types/connection-types.module';
import { HaModule } from '../ha/ha.module';
import { AutoLinkController } from './auto-link.controller';
import { AutoLinkService } from './auto-link.service';

@Module({
  imports: [ConnectionTypesModule, HaModule],
  controllers: [AutoLinkController],
  providers: [AutoLinkService],
  exports: [AutoLinkService],
})
export class AutoLinkModule {}
