import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
} from '@nestjs/common';
import { ResourceType } from './resource-type.interface';
import { ResourceTypeService } from './resource-type.service';

@Controller('resource-types')
export class ResourceTypeController {
  constructor(private readonly resourceTypeService: ResourceTypeService) { }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ResourceType> {
    return await this.resourceTypeService.findOne(id);
  }

  @Post()
  async create(@Body() resourceType: ResourceType): Promise<ResourceType> {
    const resourceTypeCreated = await this.resourceTypeService.create(resourceType);
    return resourceTypeCreated;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() resourceType: Partial<ResourceType>,
  ): Promise<ResourceType> {
    return await this.resourceTypeService.update(id, resourceType);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.resourceTypeService.remove(id);
  }

  @Get()
  async findAll(): Promise<ResourceType[]> {
    return await this.resourceTypeService.findAll();
  }
}
