import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { UserTaskService } from './user-task.service';
import { UserTaskEntity } from './user-task.entity';

@Controller('user-tasks')
export class UserTaskController {
  constructor(private readonly userTaskService: UserTaskService) { }

  @Get()
  async findAll(): Promise<UserTaskEntity[]> {
    return await this.userTaskService.findAll();
  }

  @Get('general')
  async findGeneral(): Promise<UserTaskEntity[]> {
    return await this.userTaskService.findGeneral();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<UserTaskEntity | null> {
    return await this.userTaskService.findOne(id);
  }

  @Get('project/:projectId')
  async findByProject(@Param('projectId', ParseIntPipe) projectId: number): Promise<UserTaskEntity[]> {
    return await this.userTaskService.findByProject(projectId);
  }

  @Post()
  async create(@Body() task: Partial<UserTaskEntity>): Promise<UserTaskEntity> {
    return await this.userTaskService.create(task);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: Partial<UserTaskEntity>,
  ): Promise<UserTaskEntity | null> {
    return await this.userTaskService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.userTaskService.remove(id);
  }
}
