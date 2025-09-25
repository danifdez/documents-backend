import { Controller, Get, Post, Body, Param, Delete, Patch, ParseIntPipe } from '@nestjs/common';
import { EntityTypeService } from './entity-type.service';
import { EntityTypeEntity } from './entity-type.entity';
import { CreateEntityTypeDto, UpdateEntityTypeDto } from './dto/entity-type.dto';

@Controller('entity-types')
export class EntityTypeController {
    constructor(private readonly entityTypeService: EntityTypeService) { }

    @Get()
    async findAll(): Promise<EntityTypeEntity[]> {
        return await this.entityTypeService.findAll();
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number): Promise<EntityTypeEntity | null> {
        return await this.entityTypeService.findOne(id);
    }

    @Post()
    async create(@Body() createEntityTypeDto: CreateEntityTypeDto): Promise<EntityTypeEntity> {
        return await this.entityTypeService.create(createEntityTypeDto);
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateEntityTypeDto: UpdateEntityTypeDto,
    ): Promise<EntityTypeEntity | null> {
        return await this.entityTypeService.update(id, updateEntityTypeDto);
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.entityTypeService.remove(id);
    }
}