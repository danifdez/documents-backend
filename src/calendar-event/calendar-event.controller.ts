import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe, Query } from '@nestjs/common';
import { CalendarEventService } from './calendar-event.service';
import { CalendarEventEntity } from './calendar-event.entity';

@Controller('calendar-events')
export class CalendarEventController {
  constructor(private readonly calendarEventService: CalendarEventService) { }

  @Get()
  async findAll(): Promise<CalendarEventEntity[]> {
    return await this.calendarEventService.findAll();
  }

  @Get('range')
  async findByDateRange(
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('projectId') projectId?: string,
  ): Promise<CalendarEventEntity[]> {
    return await this.calendarEventService.findByDateRange(
      start,
      end,
      projectId ? parseInt(projectId, 10) : undefined,
    );
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<CalendarEventEntity | null> {
    return await this.calendarEventService.findOne(id);
  }

  @Get('project/:projectId')
  async findByProject(@Param('projectId', ParseIntPipe) projectId: number): Promise<CalendarEventEntity[]> {
    return await this.calendarEventService.findByProject(projectId);
  }

  @Post()
  async create(@Body() event: Partial<CalendarEventEntity>): Promise<CalendarEventEntity> {
    return await this.calendarEventService.create(event);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: Partial<CalendarEventEntity>,
  ): Promise<CalendarEventEntity | null> {
    return await this.calendarEventService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.calendarEventService.remove(id);
  }
}
