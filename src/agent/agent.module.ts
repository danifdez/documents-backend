import { Module, forwardRef } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentExpirationService } from './agent-expiration.service';
import { DatabaseModule } from '../database/database.module';
import { JobModule } from '../job/job.module';
import { NotificationModule } from '../notification/notification.module';
import { IndexedFileModule } from '../indexed-file/indexed-file.module';

@Module({
  imports: [
    DatabaseModule,
    JobModule,
    NotificationModule,
    forwardRef(() => IndexedFileModule),
  ],
  controllers: [AgentController],
  providers: [AgentService, AgentExpirationService],
  exports: [AgentService],
})
export class AgentModule {}
