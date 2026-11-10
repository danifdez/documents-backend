import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../database/database.module';
import { AssistantEntity } from '../assistant/assistant.entity';
import { AgentEntity } from '../agent/agent.entity';
import {
  AgentOwnedGuard,
  AssistantOwnedGuard,
} from './guards/owned-resource.guard';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([AssistantEntity, AgentEntity]),
  ],
  providers: [AssistantOwnedGuard, AgentOwnedGuard],
  exports: [AssistantOwnedGuard, AgentOwnedGuard],
})
export class OwnershipModule {}
