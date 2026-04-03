import { Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { DataSourceService } from './data-source.service';
import { DataSourceSyncService } from './data-source-sync.service';
import { DataSourceScheduleService } from './data-source-schedule.service';
import { DataSourceProviderFactory } from './data-source-provider.factory';
import { CreateDataSourceDto, UpdateDataSourceDto, TestDataSourceDto } from './dto/data-source.dto';

@Controller('data-sources')
export class DataSourceController {
    constructor(
        private readonly dataSourceService: DataSourceService,
        private readonly syncService: DataSourceSyncService,
        private readonly scheduleService: DataSourceScheduleService,
        private readonly providerFactory: DataSourceProviderFactory,
    ) {}

    // --- Static routes FIRST (before :id) ---

    @Get('providers')
    getProviders() {
        return this.providerFactory.getAllProviders();
    }

    @Post('test')
    async testConnection(@Body() dto: TestDataSourceDto) {
        const provider = this.providerFactory.getProvider(dto.providerType);
        if (!provider) {
            throw new BadRequestException(`Unknown provider type: ${dto.providerType}. Available: ${this.providerFactory.getAllProviders().map(p => p.type).join(', ')}`);
        }
        return provider.testConnection(dto.config, dto.credentials);
    }

    @Post('preview')
    async preview(@Body() dto: TestDataSourceDto) {
        const provider = this.providerFactory.getProvider(dto.providerType);
        if (!provider) {
            throw new BadRequestException(`Unknown provider type: ${dto.providerType}`);
        }

        const result = await provider.fetch(dto.config, dto.credentials);
        return {
            records: result.records.slice(0, 10),
            schema: result.schema,
            totalRecords: result.records.length,
            hasMore: result.hasMore,
        };
    }

    // --- Collection routes ---

    @Get()
    findAll(@Query('projectId') projectId?: string) {
        return this.dataSourceService.findAll(projectId ? Number(projectId) : undefined);
    }

    @Post()
    async create(@Body() dto: CreateDataSourceDto) {
        const result = await this.dataSourceService.create(dto);
        const ds = await this.dataSourceService.findOne(result.id);
        if (ds.syncSchedule && ds.enabled) {
            this.scheduleService.registerCron(ds.id, ds.syncSchedule);
        }
        return result;
    }

    // --- Parameterized routes (after static) ---

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.dataSourceService.findOnePublic(id);
    }

    @Patch(':id')
    async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDataSourceDto) {
        const result = await this.dataSourceService.update(id, dto);
        const ds = await this.dataSourceService.findOne(id);
        this.scheduleService.updateSchedule(ds.id, ds.syncSchedule, ds.enabled);
        return result;
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        this.scheduleService.unregisterCron(id);
        await this.dataSourceService.remove(id);
        return { success: true };
    }

    @Post(':id/sync')
    async triggerSync(@Param('id', ParseIntPipe) id: number) {
        const syncLog = await this.syncService.syncDataSource(id);
        return syncLog;
    }

    @Get(':id/sync-logs')
    getSyncLogs(
        @Param('id', ParseIntPipe) id: number,
        @Query('limit') limit?: string,
    ) {
        return this.dataSourceService.getSyncLogs(id, limit ? Number(limit) : 20);
    }
}
