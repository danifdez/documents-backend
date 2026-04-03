import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RequirePermissions } from './decorators/permissions.decorator';
import { Permission } from './permission.enum';

@Controller('users')
@RequirePermissions(Permission.USER_MANAGEMENT)
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  async findAll() {
    return this.authService.findAllUsers();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.authService.findUserById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    const user = await this.authService.updateUser(id, dto);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.authService.deleteUser(id);
    if (!result) throw new NotFoundException('User not found');
    return { success: true };
  }
}
