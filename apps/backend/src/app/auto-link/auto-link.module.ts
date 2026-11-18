import { Module } from '@nestjs/common';
import { ConnectionTypesModule } from '../connection-types/connection-types.module';
import { HaModule } from '../ha/ha.module';
import { AutoLinkController } from './auto-link.controller';
import { AutoLinkService } from './auto-link.service';
import { MeshRoutesService } from './mesh-routes.service';

@Module({
  imports: [ConnectionTypesModule, HaModule],
  controllers: [AutoLinkController],
  providers: [AutoLinkService, MeshRoutesService],
  exports: [AutoLinkService],
})
export class AutoLinkModule {}
