import { Controller, Get, Post, Body, Param, Delete, Patch, ParseIntPipe, Query } from '@nestjs/common';
import { KnowledgeEntryService } from './knowledge-entry.service';
import { KnowledgeEntryEntity } from './knowledge-entry.entity';
import { CreateKnowledgeEntryDto, UpdateKnowledgeEntryDto } from './dto/knowledge-entry.dto';

@Controller('knowledge-entries')
export class KnowledgeEntryController {
    constructor(private readonly service: KnowledgeEntryService) { }

    @Get()
    async findAll(@Query('q') searchTerm?: string): Promise<KnowledgeEntryEntity[]> {
        if (searchTerm) {
            return await this.service.search(searchTerm);
        }
        return await this.service.findAll();
    }

    @Get('by-entity/:entityId')
    async findByEntityId(@Param('entityId', ParseIntPipe) entityId: number): Promise<KnowledgeEntryEntity | null> {
        return await this.service.findByEntityId(entityId);
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number): Promise<KnowledgeEntryEntity | null> {
        return await this.service.findOne(id);
    }

    @Post()
    async create(@Body() dto: CreateKnowledgeEntryDto): Promise<KnowledgeEntryEntity> {
        return await this.service.create(dto);
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateKnowledgeEntryDto,
    ): Promise<KnowledgeEntryEntity | null> {
        return await this.service.update(id, dto);
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number): Promise<{ deleted: boolean }> {
        return await this.service.remove(id);
    }
}
