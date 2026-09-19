import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
} from '@nestjs/common';
import { ReadingPointService } from './reading-point.service';
import { ReadingPointEntity } from './reading-point.entity';
import {
  CreateReadingPointDto,
  UpdateReadingPointDto,
} from './dto/reading-point.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('reading-points')
export class ReadingPointController {
  constructor(private readonly readingPointService: ReadingPointService) {}

  @Get(':id')
  async getId(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReadingPointEntity | null> {
    return await this.readingPointService.findOne(id);
  }

  @Get('doc/:docId')
  async getByDoc(
    @Param('docId', ParseIntPipe) docId: number,
  ): Promise<ReadingPointEntity[]> {
    return await this.readingPointService.findByDoc(docId);
  }

  @Get('resource/:resourceId')
  async getByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<ReadingPointEntity[]> {
    return await this.readingPointService.findByResource(resourceId);
  }

  @Post()
  @RequirePermissions(Permission.WRITE)
  async create(
    @Body() dto: CreateReadingPointDto,
  ): Promise<ReadingPointEntity> {
    const pointData: Partial<ReadingPointEntity> = {
      kind: dto.kind ?? 'section',
      label: dto.label ?? null,
      fragmentId: dto.fragmentId ?? null,
      exact: dto.exact ?? null,
      prefix: dto.prefix ?? null,
      suffix: dto.suffix ?? null,
      position: dto.position ?? 0,
      ratio: dto.ratio ?? 0,
    };

    if (dto.doc) {
      pointData.doc = { id: dto.doc } as any;
    } else if (dto.resource) {
      pointData.resource = { id: dto.resource } as any;
    }

    return await this.readingPointService.create(pointData);
  }

  @Patch(':id')
  @RequirePermissions(Permission.WRITE)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReadingPointDto,
  ): Promise<ReadingPointEntity | null> {
    return await this.readingPointService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.DELETE)
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return await this.readingPointService.delete(id);
  }
}
