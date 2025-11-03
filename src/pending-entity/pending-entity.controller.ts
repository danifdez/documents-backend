import { Controller, Get, Post, Put, Delete, Param, Body, ParseIntPipe } from '@nestjs/common';
import { PendingEntityService, CreatePendingEntityDto, UpdatePendingEntityDto } from './pending-entity.service';
import { PendingEntityEntity } from './pending-entity.entity';

@Controller('pending-entities')
export class PendingEntityController {
    constructor(private readonly service: PendingEntityService) { }

    @Get()
    async findAll(): Promise<PendingEntityEntity[]> {
        return await this.service.findAll();
    }

    @Get('resource/:resourceId')
    async findByResourceId(
        @Param('resourceId', ParseIntPipe) resourceId: number
    ): Promise<PendingEntityEntity[]> {
        return await this.service.findByResourceId(resourceId);
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number): Promise<PendingEntityEntity | null> {
        return await this.service.findOne(id);
    }

    @Post()
    async create(@Body() dto: CreatePendingEntityDto): Promise<PendingEntityEntity> {
        return await this.service.create(dto);
    }

    @Put(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdatePendingEntityDto
    ): Promise<PendingEntityEntity | null> {
        return await this.service.update(id, dto);
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number): Promise<PendingEntityEntity | null> {
        return await this.service.remove(id);
    }

    @Post('resource/:resourceId/confirm')
    async confirmEntities(
        @Param('resourceId', ParseIntPipe) resourceId: number
    ): Promise<{ confirmed: number; errors: string[] }> {
        return await this.service.confirmEntities(resourceId);
    }

    @Post(':id/merge')
    async mergeEntity(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: { targetType: 'pending' | 'confirmed'; targetId: number; aliasScope: string }
    ): Promise<any> {
        return await this.service.mergeEntity(id, dto.targetType, dto.targetId, dto.aliasScope as any);
    }

    @Post(':id/cancel-merge')
    async cancelMerge(@Param('id', ParseIntPipe) id: number): Promise<{ success: boolean; message: string }> {
        return await this.service.cancelMerge(id);
    }

    @Delete('resource/:resourceId/clear')
    async clearByResourceId(
        @Param('resourceId', ParseIntPipe) resourceId: number
    ): Promise<void> {
        return await this.service.clearByResourceId(resourceId);
    }
}
