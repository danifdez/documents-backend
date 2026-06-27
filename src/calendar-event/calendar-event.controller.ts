import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  Query,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { CalendarEventService, CalendarEventOccurrence } from './calendar-event.service';
import { CalendarEventEntity } from './calendar-event.entity';
import { CreateCalendarEventDto, UpdateCalendarEventDto } from './dto/calendar-event.dto';
import { EventOccurrenceCompletionService } from './event-occurrence-completion.service';

@Controller('calendar-events')
export class CalendarEventController {
  constructor(
    private readonly calendarEventService: CalendarEventService,
    private readonly completion: EventOccurrenceCompletionService,
  ) { }

  @Get()
  async findAll(): Promise<CalendarEventEntity[]> {
    return await this.calendarEventService.findAll();
  }

  @Get('range')
  async findByDateRange(
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('projectId') projectId?: string,
    @Query('tz') tz?: string,
  ): Promise<CalendarEventOccurrence[]> {
    return await this.calendarEventService.findByDateRange(
      start,
      end,
      projectId ? parseInt(projectId, 10) : undefined,
      tz,
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
  async create(@Body() dto: CreateCalendarEventDto): Promise<CalendarEventEntity> {
    return await this.calendarEventService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCalendarEventDto,
  ): Promise<CalendarEventEntity | null> {
    return await this.calendarEventService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.calendarEventService.remove(id);
  }

  @Post(':id/occurrences/:date/complete')
  @HttpCode(204)
  async markOccurrenceDone(
    @Param('id', ParseIntPipe) id: number,
    @Param('date') date: string,
  ): Promise<void> {
    const occurrenceDate = this.parseOccurrenceDate(date);
    await this.completion.markDone(id, occurrenceDate);
  }

  @Delete(':id/occurrences/:date/complete')
  @HttpCode(204)
  async unmarkOccurrenceDone(
    @Param('id', ParseIntPipe) id: number,
    @Param('date') date: string,
  ): Promise<void> {
    const occurrenceDate = this.parseOccurrenceDate(date);
    await this.completion.unmarkDone(id, occurrenceDate);
  }

  private parseOccurrenceDate(raw: string): Date {
    const decoded = decodeURIComponent(raw);
    const d = new Date(decoded);
    if (isNaN(d.getTime())) {
      throw new BadRequestException({ error: 'invalid_occurrence_date' });
    }
    return d;
  }
}
