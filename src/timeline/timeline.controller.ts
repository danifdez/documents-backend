import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { TimelineEntity, TimelineEvent } from './timeline.entity';
import {
  AppendTimelineEventDto,
  CreateTimelineDto,
  UpdateTimelineDto,
} from './dto/timeline.dto';
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
  async create(@Body() dto: CreateTimelineDto): Promise<TimelineEntity> {
    return await this.timelineService.create(dto);
  }

  @Post(':id/events')
  @RequirePermissions(Permission.TIMELINES)
  async appendEvent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppendTimelineEventDto,
  ): Promise<{ timelineId: number; event: TimelineEvent }> {
    const result = await this.timelineService.appendEvent(id, dto);
    if (!result) {
      throw new NotFoundException(`Timeline with id ${id} not found`);
    }
    return result;
  }

  @Patch(':id')
  @RequirePermissions(Permission.TIMELINES)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTimelineDto,
  ): Promise<TimelineEntity | null> {
    return await this.timelineService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.TIMELINES)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.timelineService.remove(id);
  }
}
