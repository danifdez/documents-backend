import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantEntity } from './assistant.entity';
import { AssistantMessageEntity } from './assistant-message.entity';
import {
  SendMessageDto,
  UpdateAssistantWorkingFolderDto,
} from './dto/assistant.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExecutionService } from '../execution/execution.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('assistants')
@RequirePermissions(Permission.ASK)
export class AssistantController {
  constructor(
    private readonly service: AssistantService,
    private readonly executionService: ExecutionService,
  ) {}

  @Get()
  async list(): Promise<AssistantEntity[]> {
    return this.service.list();
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AssistantEntity> {
    return this.service.findOne(id);
  }

  @Patch(':id/working-folder')
  @RequirePermissions(Permission.WRITE)
  async updateWorkingFolder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssistantWorkingFolderDto,
  ): Promise<AssistantEntity> {
    return this.service.updateWorkingFolder(id, dto.folderScope);
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ): Promise<{ messages: AssistantMessageEntity[]; hasMore: boolean }> {
    return this.service.getMessages(id, { limit, before });
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: unknown,
  ): Promise<{
    userMessage: AssistantMessageEntity;
    executionId: string;
  }> {
    const scope = this.executionService.resolveAccessScope(user);
    return this.service.sendMessage(id, dto.content, scope);
  }
}
