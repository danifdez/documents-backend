import { Controller, Get, Delete, Param, ParseIntPipe, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { AvatarService } from './avatar.service';
import { RequirePermissions } from './decorators/permissions.decorator';
import { Permission } from './permission.enum';

@Controller('users/:id/avatar')
export class UserAvatarController {
  constructor(private readonly avatarService: AvatarService) {}

  @Get()
  async getAvatar(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const result = await this.avatarService.getAvatarBuffer(id);
    if (!result) throw new NotFoundException('Avatar not found');
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(result.buffer);
  }

  @Delete()
  @RequirePermissions(Permission.USER_MANAGEMENT)
  async deleteAvatar(@Param('id', ParseIntPipe) id: number) {
    await this.avatarService.deleteAvatar(id);
    return { success: true };
  }
}
