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
import { ownerPrincipalFromUser } from '../auth/owner-principal';
import { ExecutionService } from '../execution/execution.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('agents')
@RequirePermissions(Permission.ASK)
export class AgentController {
  constructor(
    private readonly service: AgentService,
    private readonly executionService: ExecutionService,
  ) {}

  @Get()
  async list(@CurrentUser() user: unknown): Promise<AgentDto[]> {
    const agents = await this.service.findAll(ownerPrincipalFromUser(user));
    return agents.map(toAgentDto);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: unknown,
  ): Promise<AgentDto> {
    return toAgentDto(
      await this.service.findOne(id, ownerPrincipalFromUser(user)),
    );
  }

  @Post()
  @RequirePermissions(Permission.WRITE)
  async create(
    @Body() dto: CreateAgentDto,
    @CurrentUser() user: unknown,
  ): Promise<AgentDto> {
    return toAgentDto(
      await this.service.create(dto, ownerPrincipalFromUser(user)),
    );
  }

  @Patch(':id')
  @RequirePermissions(Permission.WRITE)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAgentDto,
    @CurrentUser() user: unknown,
  ): Promise<AgentDto> {
    return toAgentDto(
      await this.service.update(id, dto, ownerPrincipalFromUser(user)),
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.WRITE)
  @HttpCode(204)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: unknown,
  ): Promise<void> {
    await this.service.remove(id, ownerPrincipalFromUser(user));
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: unknown,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ): Promise<{ messages: AgentMessageDto[]; hasMore: boolean }> {
    const { messages, hasMore } = await this.service.getMessages(
      id,
      ownerPrincipalFromUser(user),
      { limit, before },
    );
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
