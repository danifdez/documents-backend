import { Controller, Get, Post, Body, Param, Delete, Patch, ParseIntPipe, Query } from '@nestjs/common';
import { EntityService } from './entity.service';
import { EntityEntity } from './entity.entity';
import { CreateEntityDto, UpdateEntityDto } from './dto/entity.dto';

@Controller('entities')
export class EntityController {
    constructor(private readonly entityService: EntityService) { }

    @Get()
    async findAll(): Promise<EntityEntity[]> {
        const results = await this.entityService.findAll();

        return results;
    }

    @Get('search')
    async searchByName(@Query('q') searchTerm: string): Promise<EntityEntity[]> {
        if (!searchTerm) {
            return [];
        }
        const results = await this.entityService.searchByName(searchTerm);

        return results;
    }

    @Get('search/exact')
    async findByName(@Query('name') name: string): Promise<EntityEntity | null> {
        if (!name) {
            return null;
        }
        return await this.entityService.findByName(name);
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number): Promise<EntityEntity | null> {
        return await this.entityService.findOne(id);
    }

    @Post()
    async create(@Body() createEntityDto: CreateEntityDto): Promise<EntityEntity> {
        return await this.entityService.create(createEntityDto);
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateEntityDto: UpdateEntityDto,
    ): Promise<EntityEntity | null> {
        return await this.entityService.update(id, updateEntityDto);
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.entityService.remove(id);
    }

    @Post(':sourceId/merge/:targetId')
    async merge(
        @Param('sourceId', ParseIntPipe) sourceId: number,
        @Param('targetId', ParseIntPipe) targetId: number,
    ): Promise<EntityEntity> {
        return await this.entityService.merge(sourceId, targetId);
    }
}