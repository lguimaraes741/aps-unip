import { Global, Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxService } from './outbox.service';
import { SyncController } from './sync.controller';

@Global()
@Module({
  imports: [RealtimeModule],
  controllers: [SyncController],
  providers: [OutboxService, OutboxPublisherService],
  exports: [OutboxService, OutboxPublisherService],
})
export class EventsModule {}
