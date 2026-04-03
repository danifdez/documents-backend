import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { RequirePermissions } from './decorators/permissions.decorator';
import { Permission } from './permission.enum';

@Controller('groups')
@RequirePermissions(Permission.USER_MANAGEMENT)
export class GroupsController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  async findAll() {
    return this.authService.findAllGroups();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const group = await this.authService.findGroupById(id);
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  @Post()
  async create(@Body() dto: CreateGroupDto) {
    return this.authService.createGroup(dto);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto) {
    const group = await this.authService.updateGroup(id, dto);
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.authService.deleteGroup(id);
    if (!result) throw new NotFoundException('Group not found');
    return { success: true };
  }
}
