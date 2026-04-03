import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe, Query } from '@nestjs/common';
import { CalendarEventService } from './calendar-event.service';
import { CalendarEventEntity } from './calendar-event.entity';
import { CreateCalendarEventDto, UpdateCalendarEventDto } from './dto/calendar-event.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

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
  @RequirePermissions(Permission.CALENDAR)
  async create(@Body() event: CreateCalendarEventDto): Promise<CalendarEventEntity> {
    return await this.calendarEventService.create(event);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CALENDAR)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateCalendarEventDto,
  ): Promise<CalendarEventEntity | null> {
    return await this.calendarEventService.update(id, data);
  }

  @Delete(':id')
  @RequirePermissions(Permission.CALENDAR)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.calendarEventService.remove(id);
  }
}
