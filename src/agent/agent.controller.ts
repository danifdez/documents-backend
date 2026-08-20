import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  Headers,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AgentService } from './agent.service';
import {
  AgentDto,
  AgentMessageDto,
  CreateAgentDto,
  UpdateAgentDto,
  SendAgentMessageDto,
  toAgentDto,
  toAgentMessageDto,
} from './dto/agent.dto';
import { NotificationGateway } from '../notification/notification.gateway';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExecutionService } from '../execution/execution.service';

@Controller('agents')
export class AgentController {
  constructor(
    private readonly service: AgentService,
    private readonly notificationGateway: NotificationGateway,
    private readonly executionService: ExecutionService,
  ) {}

  @Get()
  async list(): Promise<AgentDto[]> {
    const agents = await this.service.findAll();
    return agents.map(toAgentDto);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<AgentDto> {
    return toAgentDto(await this.service.findOne(id));
  }

  @Post()
  async create(@Body() dto: CreateAgentDto): Promise<AgentDto> {
    return toAgentDto(await this.service.create(dto));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAgentDto,
  ): Promise<AgentDto> {
    return toAgentDto(await this.service.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.remove(id);
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ): Promise<{ messages: AgentMessageDto[]; hasMore: boolean }> {
    const { messages, hasMore } = await this.service.getMessages(id, {
      limit,
      before,
    });
    return { messages: messages.map(toAgentMessageDto), hasMore };
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendAgentMessageDto,
    @CurrentUser() user: unknown,
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ): Promise<{
    userMessage: AgentMessageDto;
    executionId: string;
  }> {
    const scope = this.executionService.resolveAccessScope(user, workspaceId);
    const { userMessage, executionId } = await this.service.sendMessage(
      id,
      dto.content,
      scope,
    );
    return {
      userMessage: toAgentMessageDto(userMessage),
      executionId,
    };
  }

  // Internal callback: worker pushes streaming chunks for live UX.
  @Post(':id/stream-chunk')
  @HttpCode(204)
  @SkipThrottle()
  async streamChunk(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { executionId: string; chunk: string; done?: boolean },
  ): Promise<void> {
    if (!body || typeof body.chunk !== 'string') return;
    this.notificationGateway.sendAgentStreamChunk({
      agentId: id,
      executionId: body.executionId,
      chunk: body.chunk,
      done: !!body.done,
    });
  }

  // Internal callback: worker pushes a live tool event.
  @Post(':id/tool-event')
  @HttpCode(204)
  @SkipThrottle()
  async toolEvent(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      executionId: string;
      status: 'running' | 'done' | 'pending_confirmation';
      tool: {
        name: string;
        args?: string;
        summary?: string;
        entity?: {
          kind: 'note' | 'task' | 'indexedFile';
          id: number;
          title?: string;
        };
        kind?: string;
        payload?: Record<string, any>;
        confirmLabel?: string;
        cancelLabel?: string;
      };
    },
  ): Promise<void> {
    if (!body?.tool?.name) return;
    const label = body.tool.args || body.tool.name;
    const content =
      body.status === 'running'
        ? `Tool ${body.tool.name}: ${label} (in progress)`
        : `Tool ${body.tool.name}: ${label}`;
    const toolPayload: Record<string, any> = {
      name: body.tool.name,
      args: body.tool.args || '',
      summary: body.tool.summary || '',
      status: body.status,
    };
    if (body.tool.entity?.kind && Number.isInteger(body.tool.entity?.id)) {
      toolPayload.entity = {
        kind: body.tool.entity.kind,
        id: body.tool.entity.id,
        title: body.tool.entity.title || '',
      };
    }
    if (body.status === 'pending_confirmation') {
      toolPayload.kind = body.tool.kind || '';
      toolPayload.payload = body.tool.payload || {};
      toolPayload.confirmLabel = body.tool.confirmLabel || 'Confirm';
      toolPayload.cancelLabel = body.tool.cancelLabel || 'Cancel';
    }
    const eventMessage = await this.service.recordEvent(id, content, {
      kind: 'tool_executed',
      tool: toolPayload,
    });
    this.notificationGateway.sendAgentToolEvent({
      agentId: id,
      executionId: body.executionId,
      eventMessage: toAgentMessageDto(eventMessage),
    });
  }

  @Patch(':id/messages/:messageId/event-status')
  async patchEventStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() body: { status: 'done' | 'cancelled'; summary?: string },
  ): Promise<{ ok: boolean }> {
    await this.service.updateEventStatus(
      id,
      messageId,
      body.status,
      body.summary,
    );
    return { ok: true };
  }
}
