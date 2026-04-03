import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CanvasEntity } from './canvas.entity';
import { CreateCanvasDto, UpdateCanvasDto } from './dto/canvas.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('canvases')
export class CanvasController {
  constructor(private readonly canvasService: CanvasService) { }

  @Get(':id')
  async getId(@Param('id', ParseIntPipe) id: number): Promise<CanvasEntity | null> {
    return await this.canvasService.findOne(id);
  }

  @Get('thread/:threadId')
  async getByThread(
    @Param('threadId', ParseIntPipe) threadId: number,
  ): Promise<CanvasEntity[]> {
    return await this.canvasService.findByThread(threadId);
  }

  @Get('project/:projectId')
  async getByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<CanvasEntity[]> {
    return await this.canvasService.findByProject(projectId);
  }

  @Post()
  @RequirePermissions(Permission.CANVAS)
  async create(@Body() canvas: CreateCanvasDto): Promise<CanvasEntity> {
    return await this.canvasService.create(canvas);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CANVAS)
  async update(
    @Param('id', ParseIntPipe) id: number, @Body() canvas: UpdateCanvasDto): Promise<CanvasEntity | null> {
    return await this.canvasService.update(id, canvas);
  }

  @Delete(':id')
  @RequirePermissions(Permission.CANVAS)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.canvasService.remove(id);
  }
}
