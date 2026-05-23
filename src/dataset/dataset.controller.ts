import { Controller, Get, Post, Body, Param, Delete, Patch, ParseIntPipe, Query, UseInterceptors, UploadedFile, HttpException, HttpStatus, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DatasetService } from './dataset.service';
import { DatasetQueryService, RecordFilter } from './dataset-query.service';
import { DatasetCsvService } from './dataset-csv.service';
import { DatasetExtractionService } from './dataset-extraction.service';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import { ResourceService } from '../resource/resource.service';
import { CreateDatasetDto, UpdateDatasetDto, CreateDatasetRecordDto, UpdateDatasetRecordDto, CreateDatasetRelationDto, LinkRecordsDto, CsvImportMappingDto, BulkDeleteRecordsDto, CreateDatasetChartDto, UpdateDatasetChartDto, ReExtractRowDto, ReExtractCellDto } from './dto/dataset.dto';
import { ImportDatasetDto, ImportConfirmDto } from './dto/import-dataset.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('datasets')
export class DatasetController {
    constructor(
        private readonly datasetService: DatasetService,
        private readonly queryService: DatasetQueryService,
        private readonly csvService: DatasetCsvService,
        private readonly extractionService: DatasetExtractionService,
        private readonly resourceService: ResourceService,
        private readonly jobService: JobService,
    ) { }

    @Post('import')
    @RequirePermissions(Permission.DATASETS)
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
    async importFromFile(
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: ImportDatasetDto,
    ) {
        if (!file) {
            throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }

        const { headers, rows } = this.csvService.parseAll(file.buffer);
        if (headers.length === 0) {
            throw new HttpException('CSV file is empty or has no headers', HttpStatus.BAD_REQUEST);
        }

        const schema = this.csvService.inferSchema(headers, rows);
        const name = dto.name || file.originalname?.replace(/\.\w+$/, '') || 'Imported dataset';
        const projectId = dto.projectId ? Number(dto.projectId) : undefined;

        // Build records mapping each header to its inferred field key
        const keyMap = new Map(headers.map((h, i) => [i, schema[i].key]));
        const records = rows.map(row => {
            const record: Record<string, any> = {};
            row.forEach((value, i) => {
                const key = keyMap.get(i);
                if (key) record[key] = value;
            });
            return record;
        });

        return await this.datasetService.createFromCsv(name, schema, records, projectId);
    }

    @Post('from-table')
    @RequirePermissions(Permission.DATASETS)
    async createFromTable(@Body() body: { name: string; headers: string[]; rows: string[][]; projectId?: number }) {
        if (!body.headers?.length) {
            throw new HttpException('No headers provided', HttpStatus.BAD_REQUEST);
        }

        const schema = this.csvService.inferSchema(body.headers, body.rows || []);
        const name = body.name || 'Table Dataset';
        const projectId = body.projectId ? Number(body.projectId) : undefined;

        const keyMap = new Map(body.headers.map((h, i) => [i, schema[i].key]));
        const records = (body.rows || []).map(row => {
            const record: Record<string, any> = {};
            row.forEach((value, i) => {
                const key = keyMap.get(i);
                if (key) record[key] = value;
            });
            return record;
        });

        return await this.datasetService.createFromCsv(name, schema, records, projectId);
    }

    @Get()
    async findAll(@Query('projectId') projectId?: string) {
        return await this.datasetService.findAllDatasets(projectId ? Number(projectId) : undefined);
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        return await this.datasetService.findOneDataset(id);
    }

    @Post()
    @RequirePermissions(Permission.DATASETS)
    async create(@Body() dto: CreateDatasetDto) {
        return await this.datasetService.createDataset(dto);
    }

    @Patch(':id')
    @RequirePermissions(Permission.DATASETS)
    async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDatasetDto) {
        return await this.datasetService.updateDataset(id, dto);
    }

    @Post(':id/analyze-schema')
    @RequirePermissions(Permission.DATASETS)
    async analyzeSchemaChange(@Param('id', ParseIntPipe) id: number, @Body() body: { schema: any[] }) {
        return await this.datasetService.analyzeSchemaChange(id, body.schema);
    }

    // ── Tabular extraction (cambio-10) ──

    @Post(':id/extract')
    @RequirePermissions(Permission.DATASETS)
    async extractAll(@Param('id', ParseIntPipe) id: number) {
        return await this.extractionService.extractAll(id);
    }

    @Post(':id/records/:recordId/re-extract')
    @RequirePermissions(Permission.DATASETS)
    async reExtractRow(
        @Param('id', ParseIntPipe) id: number,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body() dto: ReExtractRowDto,
    ) {
        return await this.extractionService.extractRow(id, recordId, dto.columnsToExtract);
    }

    @Post(':id/records/:recordId/cells/:fieldKey/re-extract')
    @RequirePermissions(Permission.DATASETS)
    async reExtractCell(
        @Param('id', ParseIntPipe) id: number,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('fieldKey') fieldKey: string,
        @Body() dto: ReExtractCellDto,
    ) {
        return await this.extractionService.extractCell(id, recordId, fieldKey, { force: dto.force });
    }

    @Post('propose-columns')
    @RequirePermissions(Permission.DATASETS)
    async proposeColumns(@Body() body: { resourceIds: number[]; projectId?: number }) {
        if (!body?.resourceIds || !Array.isArray(body.resourceIds) || body.resourceIds.length === 0) {
            throw new HttpException('resourceIds is required and must be non-empty', HttpStatus.BAD_REQUEST);
        }
        // Pull excerpts (max 3 resources, first ~2000 chars each) — backend
        // does the IO so the worker stays a pure LLM call.
        const slice = body.resourceIds.slice(0, 3);
        const excerpts = [] as Array<{ id: number; title: string; excerpt: string }>;
        for (const rid of slice) {
            const meta = await this.resourceService.findOne(rid);
            if (!meta) continue;
            const content = await this.resourceService.getContentById(rid);
            const text = (content ?? '').slice(0, 2000);
            excerpts.push({ id: rid, title: meta.title || meta.name || `resource ${rid}`, excerpt: text });
        }
        if (excerpts.length === 0 || excerpts.every((e) => !e.excerpt.trim())) {
            throw new HttpException('no readable content in any of the given resources', HttpStatus.BAD_REQUEST);
        }
        const job = await this.jobService.create('dataset.propose-columns', JobPriority.NORMAL, {
            projectId: body.projectId ?? null,
            resources: excerpts,
        });
        return { jobId: job?.id ?? null };
    }

    @Get('propose-columns/:jobId')
    async getProposeColumnsResult(@Param('jobId', ParseIntPipe) jobId: number) {
        const job = await this.jobService.findOne(jobId);
        if (!job) throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
        return { status: job.status, result: job.result };
    }

    @Delete(':id')
    @RequirePermissions(Permission.DATASETS)
    async remove(@Param('id', ParseIntPipe) id: number) {
        return await this.datasetService.removeDataset(id);
    }

    @Post(':id/resolve-links')
    async resolveLinks(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { values: (string | number)[]; lookupField?: string },
    ) {
        return await this.datasetService.resolveLinkedRecords(id, body.values || [], body.lookupField);
    }

    @Get(':id/records')
    async findRecords(
        @Param('id', ParseIntPipe) id: number,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('sort') sort?: string,
        @Query('order') order?: string,
        @Query('relatedTo') relatedTo?: string,
        @Query('relationId') relationId?: string,
        @Query() allQuery?: Record<string, any>,
    ) {
        // Parse filter params: filter[field_op]=value
        const filters = this.parseFilters(allQuery || {});

        if (filters.length > 0 || search || sort || relatedTo) {
            return await this.queryService.queryRecords(id, {
                filters,
                search,
                sort,
                order: order as 'asc' | 'desc',
                relatedTo: relatedTo ? Number(relatedTo) : undefined,
                relationId: relationId ? Number(relationId) : undefined,
                page: page ? Number(page) : 1,
                limit: limit ? Number(limit) : 50,
            });
        }

        return await this.datasetService.findRecords(id, page ? Number(page) : 1, limit ? Number(limit) : 50);
    }

    @Post(':id/records')
    @RequirePermissions(Permission.DATASETS)
    async createRecord(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateDatasetRecordDto) {
        return await this.datasetService.createRecord(id, dto);
    }

    @Patch(':id/records/:recordId')
    @RequirePermissions(Permission.DATASETS)
    async updateRecord(
        @Param('id', ParseIntPipe) id: number,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body() dto: UpdateDatasetRecordDto,
    ) {
        return await this.datasetService.updateRecord(id, recordId, dto);
    }

    @Delete(':id/records/:recordId')
    @RequirePermissions(Permission.DATASETS)
    async removeRecord(
        @Param('id', ParseIntPipe) id: number,
        @Param('recordId', ParseIntPipe) recordId: number,
    ) {
        return await this.datasetService.removeRecord(id, recordId);
    }

    @Get(':id/records/:recordId/links')
    async getLinkedRecords(
        @Param('id', ParseIntPipe) id: number,
        @Param('recordId', ParseIntPipe) recordId: number,
    ) {
        return await this.datasetService.getLinkedRecords(id, recordId);
    }

    @Get(':id/aggregate')
    async aggregate(
        @Param('id', ParseIntPipe) id: number,
        @Query('field') field: string,
        @Query('fn') fn: string,
        @Query('groupBy') groupBy?: string,
    ) {
        if (!field || !fn) {
            throw new HttpException('field and fn query parameters are required', HttpStatus.BAD_REQUEST);
        }
        return await this.queryService.aggregate(id, { field, fn: fn as any, groupBy });
    }

    @Post(':id/stats')
    async requestStats(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { operation?: string; params?: Record<string, any> },
    ) {
        const dataset = await this.datasetService.findOneDataset(id);
        if (!dataset) {
            throw new HttpException('Dataset not found', HttpStatus.NOT_FOUND);
        }
        const operation = body.operation || 'summary';
        const job = await this.jobService.create(operation, JobPriority.NORMAL, {
            datasetId: id,
            params: body.params || {},
        });
        return { jobId: job.id, message: 'Analysis started' };
    }

    @Post('stats/query')
    async requestQueryStats(
        @Body() body: { datasetIds: number[]; operation: string; params?: Record<string, any> },
    ) {
        if (!body.datasetIds || body.datasetIds.length === 0) {
            throw new HttpException('datasetIds required', HttpStatus.BAD_REQUEST);
        }
        const operation = body.operation || 'query';
        const job = await this.jobService.create(operation, JobPriority.NORMAL, {
            datasetIds: body.datasetIds,
            params: body.params || {},
        });
        return { jobId: job.id, message: 'Query analysis started' };
    }

    @Get(':id/stats/:jobId')
    async getStatsResult(
        @Param('id', ParseIntPipe) id: number,
        @Param('jobId', ParseIntPipe) jobId: number,
    ) {
        const job = await this.jobService.findOne(jobId);
        if (!job) {
            throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
        }
        return {
            status: job.status,
            result: job.result,
        };
    }

    @Post(':id/import')
    @RequirePermissions(Permission.DATASETS)
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
    async importPreview(
        @Param('id', ParseIntPipe) id: number,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) {
            throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }
        const preview = this.csvService.parsePreview(file.buffer);
        return preview;
    }

    @Post(':id/import/confirm')
    @RequirePermissions(Permission.DATASETS)
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
    async importConfirm(
        @Param('id', ParseIntPipe) id: number,
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: ImportConfirmDto,
    ) {
        if (!file) {
            throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }

        const mappings = typeof dto.mappings === 'string' ? JSON.parse(dto.mappings) : dto.mappings;
        const skipFirstRow = dto.skipFirstRow !== 'false' && dto.skipFirstRow !== false;

        const records = this.csvService.parseAndMap(file.buffer, mappings, skipFirstRow);
        return await this.datasetService.bulkCreateRecords(id, records);
    }

    @Get(':id/relations')
    async findRelations(@Param('id', ParseIntPipe) id: number) {
        return await this.datasetService.findRelations(id);
    }

    @Post('relations')
    @RequirePermissions(Permission.DATASETS)
    async createRelation(@Body() dto: CreateDatasetRelationDto) {
        return await this.datasetService.createRelation(dto);
    }

    @Delete('relations/:relationId')
    @RequirePermissions(Permission.DATASETS)
    async removeRelation(@Param('relationId', ParseIntPipe) relationId: number) {
        return await this.datasetService.removeRelation(relationId);
    }

    @Post('relations/:relationId/links')
    @RequirePermissions(Permission.DATASETS)
    async linkRecords(
        @Param('relationId', ParseIntPipe) relationId: number,
        @Body() dto: LinkRecordsDto,
    ) {
        return await this.datasetService.linkRecords(relationId, dto);
    }

    @Delete('relations/:relationId/links/:linkId')
    @RequirePermissions(Permission.DATASETS)
    async unlinkRecords(
        @Param('relationId', ParseIntPipe) relationId: number,
        @Param('linkId', ParseIntPipe) linkId: number,
    ) {
        return await this.datasetService.unlinkRecords(relationId, linkId);
    }

    // ── Export CSV ──

    @Get(':id/export')
    async exportCsv(
        @Param('id', ParseIntPipe) id: number,
        @Query('include_anchors') includeAnchorsQuery: string | undefined,
        @Res() res: Response,
    ) {
        const dataset = await this.datasetService.findOneDataset(id);
        if (!dataset) {
            throw new HttpException('Dataset not found', HttpStatus.NOT_FOUND);
        }

        const records = await this.datasetService.findAllRecords(id);
        const includeAnchors = includeAnchorsQuery === 'true' || includeAnchorsQuery === '1';

        let resolver: ((rid: number) => string) | undefined;
        if (includeAnchors) {
            const ids = new Set<number>();
            for (const r of records) {
                const meta = (r as any).cellMetadata as Record<string, any> | null;
                if (!meta) continue;
                for (const key of Object.keys(meta)) {
                    const sid = meta[key]?.sourceResourceId;
                    if (typeof sid === 'number') ids.add(sid);
                }
            }
            const resources = await this.resourceService.findByIds([...ids]);
            const map = new Map<number, string>();
            for (const r of resources) {
                map.set(r.id, r.title || r.name || `Resource ${r.id}`);
            }
            resolver = (rid: number) => map.get(rid) || '';
        }

        const csv = this.csvService.exportRecordsCsv(dataset.schema, records, {
            includeAnchors,
            resourceTitleResolver: resolver,
        });

        const filename = dataset.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.csv';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }

    // ── Bulk Delete Records ──

    @Delete(':id/records/bulk')
    @RequirePermissions(Permission.DATASETS)
    async bulkDeleteRecords(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: BulkDeleteRecordsDto,
    ) {
        return await this.datasetService.bulkDeleteRecords(id, dto.recordIds);
    }

    // ── Saved Charts CRUD ──

    @Get(':id/charts')
    async findCharts(@Param('id', ParseIntPipe) id: number) {
        return await this.datasetService.findCharts(id);
    }

    @Post(':id/charts')
    @RequirePermissions(Permission.DATASETS)
    async createChart(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: CreateDatasetChartDto,
    ) {
        return await this.datasetService.createChart(id, dto);
    }

    @Patch('charts/:chartId')
    @RequirePermissions(Permission.DATASETS)
    async updateChart(
        @Param('chartId', ParseIntPipe) chartId: number,
        @Body() dto: UpdateDatasetChartDto,
    ) {
        return await this.datasetService.updateChart(chartId, dto);
    }

    @Delete('charts/:chartId')
    @RequirePermissions(Permission.DATASETS)
    async removeChart(@Param('chartId', ParseIntPipe) chartId: number) {
        return await this.datasetService.removeChart(chartId);
    }

    private parseFilters(query: Record<string, any>): RecordFilter[] {
        const filters: RecordFilter[] = [];
        const filterRegex = /^(\w+?)_(eq|gt|gte|lt|lte|contains)$/;

        // NestJS parses filter[key]=value as { filter: { key: value } }
        const filterObj = query.filter;
        if (filterObj && typeof filterObj === 'object') {
            for (const [key, value] of Object.entries(filterObj)) {
                const match = key.match(filterRegex);
                if (match) {
                    filters.push({
                        field: match[1],
                        operator: match[2] as RecordFilter['operator'],
                        value: String(value),
                    });
                }
            }
        }

        return filters;
    }
}
