import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ThreadService } from './thread.service';
import { Thread } from './thread.interface';

@Controller('threads')
export class ThreadController {
  constructor(private readonly threadService: ThreadService) { }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Thread> {
    return await this.threadService.findOne(id);
  }

  @Get('by-project/:projectId')
  async getAll(@Param('projectId') projectId: string): Promise<Thread[]> {
    return await this.threadService.findByProject(projectId);
  }

  @Post()
  async create(@Body() thread: Thread): Promise<Thread> {
    return await this.threadService.create(thread);
  }
}
