import { Controller, Delete, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ResourceDateService } from './resource-date.service';
import { ResourceDateEntity } from './resource-date.entity';

@Controller('resources/:resourceId/dates')
export class ResourceDateController {
  constructor(private readonly service: ResourceDateService) {}

  @Get()
  findByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<ResourceDateEntity[]> {
    return this.service.findByResourceId(resourceId);
  }

  @Delete(':id')
  async remove(
    @Param('resourceId', ParseIntPipe) _resourceId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ deleted: boolean }> {
    const deleted = await this.service.remove(id);
    return { deleted };
  }
}
