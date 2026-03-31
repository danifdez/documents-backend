import { Controller, Get, Post, Body, Param, Delete, Patch, ParseIntPipe } from '@nestjs/common';
import { ResourceTypeService } from './resource-type.service';
import { ResourceTypeEntity } from './resource-type.entity';
import { CreateResourceTypeDto, UpdateResourceTypeDto } from './dto/resource-type.dto';

@Controller('resource-types')
export class ResourceTypeController {
  constructor(private readonly resourceTypeService: ResourceTypeService) { }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ResourceTypeEntity | null> {
    return await this.resourceTypeService.findOne(id);
  }

  @Post()
  async create(@Body() resourceType: CreateResourceTypeDto): Promise<ResourceTypeEntity | any> {
    return await this.resourceTypeService.create(resourceType);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() resourceType: UpdateResourceTypeDto,
  ): Promise<ResourceTypeEntity | any | null> {
    return await this.resourceTypeService.update(id, resourceType);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.resourceTypeService.remove(id);
  }

  @Get()
  async findAll(): Promise<(ResourceTypeEntity | any)[]> {
    return await this.resourceTypeService.findAll();
  }
}
