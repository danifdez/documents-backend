import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  IsBoolean,
  ValidateIf,
} from 'class-validator';
import { AgentEntity } from '../agent.entity';
import { AgentMessageEntity } from '../agent-message.entity';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @ValidateIf((_, v) => v !== null)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  folderScope?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  icon?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  sub?: string;

  @IsBoolean()
  @IsOptional()
  pinned?: boolean;
}

export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @ValidateIf((_, v) => v !== null)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  folderScope?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  icon?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  sub?: string;

  @IsBoolean()
  @IsOptional()
  pinned?: boolean;
}

export class SendAgentMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

export interface AgentDto {
  id: number;
  name: string;
  systemPrompt: string | null;
  folderScope: string | null;
  icon: string | null;
  sub: string | null;
  pinned: boolean;
  lastSeenAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toAgentDto(entity: AgentEntity): AgentDto {
  return {
    id: entity.id,
    name: entity.name,
    systemPrompt: entity.systemPrompt,
    folderScope: entity.folderScope,
    icon: entity.icon,
    sub: entity.sub,
    pinned: entity.pinned,
    lastSeenAt: entity.lastSeenAt ? entity.lastSeenAt.toISOString() : null,
    expiresAt: entity.expiresAt ? entity.expiresAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export interface AgentMessageDto {
  id: number;
  agentId: number;
  role: 'user' | 'assistant' | 'system' | 'event';
  content: string;
  jobId: number | null;
  error: string | null;
  event: Record<string, any> | null;
  createdAt: string;
}

export function toAgentMessageDto(entity: AgentMessageEntity): AgentMessageDto {
  return {
    id: entity.id,
    agentId: entity.agentId,
    role: entity.role,
    content: entity.content,
    jobId: entity.jobId,
    error: entity.error,
    event: entity.event,
    createdAt: entity.createdAt.toISOString(),
  };
}
