import { Controller, Get, Post, Body, Param, Delete, Patch, Query, ParseIntPipe } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectEntity } from './project.entity';

@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
  ) { }

  @Get('search')
  async search(@Query('q') query: string): Promise<ProjectEntity[]> {
    return await this.projectService.search(query);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ProjectEntity | null> {
    return await this.projectService.findOne(id);
  }

  @Get()
  async getAll(): Promise<ProjectEntity[]> {
    return await this.projectService.findAll();
  }

  @Post()
  async create(@Body() project: Partial<ProjectEntity>): Promise<ProjectEntity> {
    return await this.projectService.create(project);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() project: Partial<ProjectEntity>,
  ): Promise<ProjectEntity | null> {
    return await this.projectService.update(id, project);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.projectService.remove(id);
  }
}
