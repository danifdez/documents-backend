import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateMemoryEntryDto, UpdateMemoryEntryDto } from './dto/memory.dto';
import { MemoryEntryEntity } from './memory-entry.entity';
import { MemoryOwnerType, MemoryService } from './memory.service';

abstract class OwnerMemoryController {
  protected abstract readonly ownerType: MemoryOwnerType;

  constructor(protected readonly service: MemoryService) {}

  @Get()
  list(
    @Param('ownerId', ParseIntPipe) ownerId: number,
  ): Promise<MemoryEntryEntity[]> {
    return this.service.list(this.ownerType, ownerId);
  }

  @Post()
  create(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @Body() dto: CreateMemoryEntryDto,
  ): Promise<MemoryEntryEntity> {
    return this.service.create(this.ownerType, ownerId, dto);
  }

  @Patch(':id')
  update(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryEntity> {
    return this.service.update(this.ownerType, ownerId, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(this.ownerType, ownerId, id);
  }

  @Delete()
  clear(
    @Param('ownerId', ParseIntPipe) ownerId: number,
  ): Promise<{ deleted: number }> {
    return this.service.clear(this.ownerType, ownerId);
  }
}

@Controller('assistants/:ownerId/memory')
export class AssistantMemoryController extends OwnerMemoryController {
  protected readonly ownerType = 'assistant' as const;
}

@Controller('agents/:ownerId/memory')
export class AgentMemoryController extends OwnerMemoryController {
  protected readonly ownerType = 'agent' as const;
}
