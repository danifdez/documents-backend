import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Query,
} from '@nestjs/common';
import { ProjectService } from './project.service';
import { Project } from './project.interface';
import { ThreadService } from 'src/thread/thread.service';
import { DocService } from 'src/doc/doc.service';

@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly threadService: ThreadService,
    private readonly docService: DocService,
  ) { }

  @Get('search')
  async search(@Query('q') query: string): Promise<Project[]> {
    return await this.projectService.search(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Project> {
    return await this.projectService.findOne(id);
  }

  @Get()
  async getAll(): Promise<Project[]> {
    return await this.projectService.findAll();
  }

  @Post()
  async create(@Body() project: Project): Promise<Project> {
    return await this.projectService.create(project);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() project: Partial<Project>,
  ): Promise<Project> {
    return await this.projectService.update(id, project);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.projectService.remove(id);
  }
}
