import { Controller, Get, Post, Body, Param, Delete, Patch, ParseIntPipe, Query } from '@nestjs/common';
import { EntityService } from './entity.service';
import { EntityEntity } from './entity.entity';
import { CreateEntityDto, UpdateEntityDto } from './dto/entity.dto';

@Controller('entities')
export class EntityController {
    constructor(private readonly entityService: EntityService) { }

    @Get()
    async findAll(): Promise<EntityEntity[]> {
        return await this.entityService.findAll();
    }

    @Get('search')
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
}