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
} from '@nestjs/common';
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExecutionService } from '../execution/execution.service';

@Controller('agents')
export class AgentController {
  constructor(
    private readonly service: AgentService,
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
  ): Promise<{
    userMessage: AgentMessageDto;
    executionId: string;
  }> {
    const scope = this.executionService.resolveAccessScope(user);
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
}
