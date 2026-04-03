import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { NoteService } from './note.service';
import { NoteEntity } from './note.entity';
import { CreateNoteDto, UpdateNoteDto } from './dto/note.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('notes')
export class NoteController {
  constructor(private readonly noteService: NoteService) { }

  @Get()
  async findAll(): Promise<NoteEntity[]> {
    return await this.noteService.findAll();
  }

  @Get('general')
  async findGeneral(): Promise<NoteEntity[]> {
    return await this.noteService.findGeneral();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<NoteEntity | null> {
    return await this.noteService.findOne(id);
  }

  @Get('project/:projectId')
  async findByProject(@Param('projectId', ParseIntPipe) projectId: number): Promise<NoteEntity[]> {
    return await this.noteService.findByProject(projectId);
  }

  @Get('thread/:threadId')
  async findByThread(@Param('threadId', ParseIntPipe) threadId: number): Promise<NoteEntity[]> {
    return await this.noteService.findByThread(threadId);
  }

  @Post()
  @RequirePermissions(Permission.NOTES)
  async create(@Body() note: CreateNoteDto): Promise<NoteEntity> {
    return await this.noteService.create(note);
  }

  @Patch(':id')
  @RequirePermissions(Permission.NOTES)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateNoteDto,
  ): Promise<NoteEntity | null> {
    return await this.noteService.update(id, data);
  }

  @Delete(':id')
  @RequirePermissions(Permission.NOTES)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.noteService.remove(id);
  }
}
