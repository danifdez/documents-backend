import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { UserTaskService } from './user-task.service';
import { UserTaskEntity } from './user-task.entity';
import { CreateUserTaskDto, UpdateUserTaskDto } from './dto/user-task.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

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
  @RequirePermissions(Permission.TASKS)
  async create(@Body() dto: CreateUserTaskDto): Promise<UserTaskEntity> {
    return await this.userTaskService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TASKS)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserTaskDto,
  ): Promise<UserTaskEntity | null> {
    return await this.userTaskService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.TASKS)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.userTaskService.remove(id);
  }
}
