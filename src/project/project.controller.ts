import { Controller, Get, Post, Body, Param, Delete, Patch, Query, ParseIntPipe } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectEntity } from './project.entity';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
  ) { }

  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ProjectEntity[]> {
    return await this.projectService.search(query, includeArchived === 'true');
  }

  @Get(':id/stats')
  async getStats(@Param('id', ParseIntPipe) id: number): Promise<Record<string, any>> {
    return await this.projectService.getStats(id);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ProjectEntity | null> {
    return await this.projectService.findOne(id);
  }

  @Get()
  async getAll(@Query('includeArchived') includeArchived?: string): Promise<ProjectEntity[]> {
    return await this.projectService.findAll(includeArchived === 'true');
  }

  @Post()
  @RequirePermissions(Permission.PROJECTS)
  async create(@Body() project: CreateProjectDto): Promise<ProjectEntity> {
    return await this.projectService.create(project);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() project: UpdateProjectDto,
  ): Promise<ProjectEntity | null> {
    return await this.projectService.update(id, project);
  }

  @Delete(':id')
  @RequirePermissions(Permission.PROJECTS)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.projectService.remove(id);
  }
}
