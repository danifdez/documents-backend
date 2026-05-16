import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe } from '@nestjs/common';
import { AssistantMemoryService } from './assistant-memory.service';
import { MemoryEntryEntity } from './memory-entry.entity';
import { CreateMemoryEntryDto, UpdateMemoryEntryDto } from './dto/memory.dto';

@Controller('assistants/:assistantId/memory')
export class AssistantMemoryController {
  constructor(private readonly service: AssistantMemoryService) {}

  @Get()
  async list(@Param('assistantId', ParseIntPipe) assistantId: number): Promise<MemoryEntryEntity[]> {
    return this.service.list(assistantId);
  }

  @Post()
  async create(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Body() dto: CreateMemoryEntryDto,
  ): Promise<MemoryEntryEntity> {
    return this.service.create(assistantId, dto);
  }

  @Patch(':id')
  async update(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryEntity> {
    return this.service.update(assistantId, id, dto);
  }

  @Delete(':id')
  async remove(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.remove(assistantId, id);
  }

  @Delete()
  async clear(
    @Param('assistantId', ParseIntPipe) assistantId: number,
  ): Promise<{ deleted: number }> {
    return this.service.clear(assistantId);
  }
}
