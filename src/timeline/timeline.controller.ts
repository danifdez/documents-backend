import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { TimelineEntity } from './timeline.entity';
import { CreateTimelineDto, UpdateTimelineDto } from './dto/timeline.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

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
  @RequirePermissions(Permission.TIMELINES)
  async create(@Body() data: CreateTimelineDto): Promise<TimelineEntity> {
    return await this.timelineService.create(data);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TIMELINES)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateTimelineDto,
  ): Promise<TimelineEntity | null> {
    return await this.timelineService.update(id, data);
  }

  @Delete(':id')
  @RequirePermissions(Permission.TIMELINES)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.timelineService.remove(id);
  }
}
