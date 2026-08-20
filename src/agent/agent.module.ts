import { Module, forwardRef } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentExpirationService } from './agent-expiration.service';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { IndexedFileModule } from '../indexed-file/indexed-file.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [
    DatabaseModule,
    ExecutionModule,
    NotificationModule,
    forwardRef(() => IndexedFileModule),
  ],
  controllers: [AgentController],
  providers: [AgentService, AgentExpirationService],
  exports: [AgentService],
})
export class AgentModule {}
