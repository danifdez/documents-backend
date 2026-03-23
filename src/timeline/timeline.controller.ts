import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { TimelineEntity } from './timeline.entity';

@Controller('timelines')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) { }

  @Get('project/:projectId')
  async findByProject(@Param('projectId', ParseIntPipe) projectId: number): Promise<TimelineEntity[]> {
    return await this.timelineService.findByProject(projectId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<TimelineEntity | null> {
    return await this.timelineService.findOne(id);
  }

  @Post()
  async create(@Body() data: Partial<TimelineEntity>): Promise<TimelineEntity> {
    return await this.timelineService.create(data);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: Partial<TimelineEntity>,
  ): Promise<TimelineEntity | null> {
    return await this.timelineService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.timelineService.remove(id);
  }
}
