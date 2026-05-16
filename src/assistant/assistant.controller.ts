import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, HttpCode } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AssistantService } from './assistant.service';
import { AssistantEntity } from './assistant.entity';
import { AssistantMessageEntity } from './assistant-message.entity';
import { CreateAssistantDto, UpdateAssistantDto, SendMessageDto } from './dto/assistant.dto';
import { NotificationGateway } from '../notification/notification.gateway';

@Controller('assistants')
export class AssistantController {
  constructor(
    private readonly service: AssistantService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  @Get()
  async list(): Promise<AssistantEntity[]> {
    return this.service.list();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<AssistantEntity> {
    return this.service.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateAssistantDto): Promise<AssistantEntity> {
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssistantDto,
  ): Promise<AssistantEntity> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }

  @Get(':id/messages')
  async getMessages(@Param('id', ParseIntPipe) id: number): Promise<AssistantMessageEntity[]> {
    return this.service.getMessages(id);
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
  ): Promise<{ userMessage: AssistantMessageEntity; jobId: number | null }> {
    return this.service.sendMessage(id, dto.content);
  }

  /**
   * Internal callback for the Python worker to push streaming chunks while
   * generating an assistant reply. Forwards the chunk via socket so the UI
   * can render tokens as they arrive. The job result still flows through the
   * normal completion path — this endpoint is purely for live UX.
   *
   * No auth: the worker calls localhost. If we ever expose this to the
   * outside, add a shared secret header.
   */
  @Post(':id/stream-chunk')
  @HttpCode(204)
  @SkipThrottle()
  async streamChunk(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { jobId: number; chunk: string; done?: boolean },
  ): Promise<void> {
    if (!body || typeof body.chunk !== 'string') return;
    this.notificationGateway.sendAssistantStreamChunk({
      assistantId: id,
      jobId: body.jobId,
      chunk: body.chunk,
      done: !!body.done,
    });
  }

  /**
   * Internal callback for the worker to push a live event message (typically
   * "tool started/finished") while a job is in flight. We persist it as an
   * assistant event message AND broadcast it via socket so the UI shows
   * "🔍 Buscando…" the instant the tool runs, instead of waiting for the
   * final assistantResponse. Status `running` lets the frontend mark the card
   * as in-progress; `done` finalises it with a summary.
   */
  @Post(':id/tool-event')
  @HttpCode(204)
  @SkipThrottle()
  async toolEvent(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      jobId: number;
      status: 'running' | 'done';
      tool: {
        name: string;
        args?: string;
        summary?: string;
        // Optional: set on `done` events that created something deletable
        // (e.g. note, task). The frontend uses this to show a Borrar button.
        entity?: { kind: 'note' | 'task'; id: number; title?: string };
      };
    },
  ): Promise<void> {
    if (!body?.tool?.name) return;
    const label = body.tool.args || body.tool.name;
    const content = body.status === 'running'
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
    const eventMessage = await this.service.recordEvent(
      id,
      content,
      { kind: 'tool_executed', tool: toolPayload },
    );
    this.notificationGateway.sendAssistantToolEvent({
      assistantId: id,
      jobId: body.jobId,
      eventMessage,
    });
  }
}
