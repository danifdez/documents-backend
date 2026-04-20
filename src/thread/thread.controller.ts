import { Controller, Get, Post, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ThreadService } from './thread.service';
import { ThreadEntity } from './thread.entity';
import { CreateThreadDto } from './dto/thread.dto';

@Controller('threads')
export class ThreadController {
  constructor(private readonly threadService: ThreadService) { }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ThreadEntity | null> {
    return await this.threadService.findOne(id);
  }

  @Get('by-project/:projectId')
  async getAll(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ThreadEntity[]> {
    return await this.threadService.findByProject(projectId, includeArchived === 'true');
  }

  @Get(':id/children')
  async getChildren(
    @Param('id', ParseIntPipe) id: number,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ThreadEntity[]> {
    return await this.threadService.findByParent(id, includeArchived === 'true');
  }

  @Post()
  async create(@Body() dto: CreateThreadDto): Promise<ThreadEntity> {
    return await this.threadService.create(dto);
  }
}
