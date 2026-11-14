import { Module } from '@nestjs/common';
import { AutoLinkModule } from '../auto-link/auto-link.module';
import { ConnectionTypesModule } from '../connection-types/connection-types.module';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  imports: [ConnectionTypesModule, AutoLinkModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
})
export class ConnectionsModule {}
