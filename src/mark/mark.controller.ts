import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { MarkService } from './mark.service';
import { MarkEntity } from './mark.entity';
import { CreateMarkDto, UpdateMarkDto } from './dto/mark.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('marks')
export class MarkController {
  constructor(private readonly markService: MarkService) { }

  @Get(':id')
  async getId(@Param('id', ParseIntPipe) id: number): Promise<MarkEntity | null> {
    return await this.markService.findOne(id);
  }

  @Get('doc/:docId')
  async getByDoc(
    @Param('docId', ParseIntPipe) docId: number,
  ): Promise<MarkEntity[]> {
    return await this.markService.findByDoc(docId);
  }

  @Get('resource/:resourceId')
  async getByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<MarkEntity[]> {
    return await this.markService.findByResource(resourceId);
  }

  @Post()
  @RequirePermissions(Permission.WRITE)
  async create(@Body() dto: CreateMarkDto): Promise<MarkEntity> {
    const markData: Partial<MarkEntity> = {
      content: dto.content,
    };

    if (dto.doc) {
      markData.doc = { id: dto.doc } as any;
    } else if (dto.resource) {
      markData.resource = { id: dto.resource } as any;
    }

    return await this.markService.create(markData);
  }

  @Patch(':id')
  @RequirePermissions(Permission.WRITE)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMarkDto,
  ): Promise<MarkEntity | null> {
    return await this.markService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.DELETE)
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return await this.markService.delete(id);
  }
}
