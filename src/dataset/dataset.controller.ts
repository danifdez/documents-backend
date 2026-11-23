import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  BadRequestException,
  Param,
  Delete,
  Patch,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DatasetService } from './dataset.service';
import { DatasetQueryService, RecordFilter } from './dataset-query.service';
import { DatasetCsvService } from './dataset-csv.service';
import { DatasetExtractionService } from './dataset-extraction.service';
import { authorizeInferenceCapture } from '../execution/inference-capture';
import { ExecutionService } from '../execution/execution.service';
import {
  CreateDatasetDto,
  UpdateDatasetDto,
  CreateDatasetRecordDto,
  UpdateDatasetRecordDto,
  CreateDatasetRelationDto,
  LinkRecordsDto,
  BulkDeleteRecordsDto,
  CreateDatasetChartDto,
  UpdateDatasetChartDto,
  ReExtractRowDto,
  ReExtractCellDto,
} from './dto/dataset.dto';
import { ImportDatasetDto, ImportConfirmDto } from './dto/import-dataset.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import { DatasetAnalysisService } from './dataset-analysis.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('datasets')
export class DatasetController {
  constructor(
    private readonly datasetService: DatasetService,
    private readonly queryService: DatasetQueryService,
    private readonly csvService: DatasetCsvService,
    private readonly extractionService: DatasetExtractionService,
    private readonly executionService: ExecutionService,
    private readonly analysisService: DatasetAnalysisService,
  ) {}

  @Post('import')
  @RequirePermissions(Permission.DATASETS)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async importFromFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportDatasetDto,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    const { headers, rows } = this.csvService.parseAll(file.buffer);
    if (headers.length === 0) {
      throw new HttpException(
        'CSV file is empty or has no headers',
        HttpStatus.BAD_REQUEST,
      );
    }

    const schema = this.csvService.inferSchema(headers, rows);
    const name =
      dto.name ||
      file.originalname?.replace(/\.\w+$/, '') ||
      'Imported dataset';
    const projectId = dto.projectId ? Number(dto.projectId) : undefined;

    const records = this.csvService.mapRowsToRecords(schema, rows);

    return await this.datasetService.createFromCsv(
      name,
      schema,
      records,
      projectId,
    );
  }

  @Post('from-table')
  @RequirePermissions(Permission.DATASETS)
  async createFromTable(
    @Body()
    body: {
      name: string;
      headers: string[];
      rows: string[][];
      projectId?: number;
    },
  ) {
    if (!body.headers?.length) {
      throw new HttpException('No headers provided', HttpStatus.BAD_REQUEST);
    }

    const schema = this.csvService.inferSchema(body.headers, body.rows || []);
    const name = body.name || 'Table Dataset';
    const projectId = body.projectId ? Number(body.projectId) : undefined;

    const records = this.csvService.mapRowsToRecords(schema, body.rows || []);

    return await this.datasetService.createFromCsv(
      name,
      schema,
      records,
      projectId,
    );
  }

  @Get()
  async findAll(@Query('projectId') projectId?: string) {
    return await this.datasetService.findAllDatasets(
      projectId ? Number(projectId) : undefined,
    );
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
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDatasetDto,
  ) {
    return await this.datasetService.updateDataset(id, dto);
  }

  @Post(':id/analyze-schema')
  @RequirePermissions(Permission.DATASETS)
  async analyzeSchemaChange(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { schema: any[] },
  ) {
    return await this.datasetService.analyzeSchemaChange(id, body.schema);
  }

  @Post(':id/extract')
  @RequirePermissions(Permission.DATASETS)
  async extractAll(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: unknown,
    @Headers('x-evaluation-consent') consent?: string,
    @Body('resourceId') resourceId?: unknown,
  ) {
    const capture = authorizeInferenceCapture(user, consent);
    if (
      capture &&
      (typeof resourceId !== 'number' ||
        !Number.isSafeInteger(resourceId) ||
        resourceId < 1)
    ) {
      throw new BadRequestException(
        'Select one resource to authorize inference capture',
      );
    }
    const { ownerPrincipal } = this.executionService.resolveAccessScope(user);
    return this.extractionService.extractAll(
      id,
      ownerPrincipal,
      capture ? (resourceId as number) : undefined,
    );
  }

  @Post(':id/records/:recordId/re-extract')
  @RequirePermissions(Permission.DATASETS)
  async reExtractRow(
    @Param('id', ParseIntPipe) id: number,
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: ReExtractRowDto,
    @CurrentUser() user: unknown,
  ) {
    return await this.extractionService.extractRow(
      id,
      recordId,
      this.executionService.resolveAccessScope(user).ownerPrincipal,
      dto.columnsToExtract,
    );
  }

  @Post(':id/records/:recordId/cells/:fieldKey/re-extract')
  @RequirePermissions(Permission.DATASETS)
  async reExtractCell(
    @Param('id', ParseIntPipe) id: number,
    @Param('recordId', ParseIntPipe) recordId: number,
    @Param('fieldKey') fieldKey: string,
    @Body() dto: ReExtractCellDto,
    @CurrentUser() user: unknown,
  ) {
    return this.extractionService.extractCell(
      id,
      recordId,
      fieldKey,
      this.executionService.resolveAccessScope(user).ownerPrincipal,
      { force: dto.force },
    );
  }

  @Post('propose-columns')
  @RequirePermissions(Permission.DATASETS)
  async proposeColumns(
    @Body() body: { resourceIds: number[]; projectId?: number },
    @CurrentUser() user: unknown,
  ) {
    return await this.extractionService.proposeColumns(
      body?.resourceIds,
      this.executionService.resolveAccessScope(user).ownerPrincipal,
      body?.projectId,
    );
  }

  @Get('propose-columns/:executionId')
  @RequirePermissions(Permission.DATASETS)
  async getProposeColumnsResult(
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @CurrentUser() user: unknown,
  ) {
    const execution = await this.executionService.readOwnedResult(
      executionId,
      this.executionService.resolveAccessScope(user),
    );
    return { status: execution.status, result: execution.result };
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
    return await this.datasetService.resolveLinkedRecords(
      id,
      body.values || [],
      body.lookupField,
    );
  }

  @Get(':id/records')
  async findRecords(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: Record<string, any> = {},
  ) {
    const { page, limit, search, sort, order, relatedTo, relationId } = query;
    // Parse filter params: filter[field_op]=value
    const filters = this.parseFilters(query);

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

    return await this.datasetService.findRecords(
      id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  @Post(':id/records')
  @RequirePermissions(Permission.DATASETS)
  async createRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDatasetRecordDto,
  ) {
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
    @Param('id', ParseIntPipe) _id: number,
    @Param('recordId', ParseIntPipe) recordId: number,
  ) {
    return await this.datasetService.getLinkedRecords(recordId);
  }

  @Get(':id/aggregate')
  async aggregate(
    @Param('id', ParseIntPipe) id: number,
    @Query('field') field: string,
    @Query('fn') fn: string,
    @Query('groupBy') groupBy?: string,
  ) {
    if (!field || !fn) {
      throw new HttpException(
        'field and fn query parameters are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.queryService.aggregate(id, {
      field,
      fn: fn as any,
      groupBy,
    });
  }

  @Post(':id/stats')
  @RequirePermissions(Permission.DATASETS)
  async requestStats(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { operation?: unknown; params?: unknown },
    @CurrentUser() user: unknown,
    @Body('requestId', new ParseUUIDPipe({ version: '4', optional: true }))
    requestId?: string,
  ) {
    const execution = await this.analysisService.createExecution(
      body.operation || 'summary',
      [id],
      body.params || {},
      this.executionService.resolveAccessScope(user),
      requestId,
    );
    return { executionId: execution.executionId, message: 'Analysis started' };
  }

  @Post('stats/query')
  @RequirePermissions(Permission.DATASETS)
  async requestQueryStats(
    @Body()
    body: {
      datasetIds: number[];
      operation?: unknown;
      params?: unknown;
    },
    @CurrentUser() user: unknown,
    @Body('requestId', new ParseUUIDPipe({ version: '4', optional: true }))
    requestId?: string,
  ) {
    if (!Array.isArray(body.datasetIds) || body.datasetIds.length === 0) {
      throw new HttpException('datasetIds required', HttpStatus.BAD_REQUEST);
    }
    const execution = await this.analysisService.createExecution(
      body.operation || 'query',
      body.datasetIds,
      body.params || {},
      this.executionService.resolveAccessScope(user),
      requestId,
    );
    return {
      executionId: execution.executionId,
      message: 'Query analysis started',
    };
  }

  @Get(':id/stats/:executionId')
  @RequirePermissions(Permission.DATASETS)
  async getStatsResult(
    @Param('id', ParseIntPipe) _id: number,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @CurrentUser() user: unknown,
  ) {
    const execution = await this.executionService.readOwnedResult(
      executionId,
      this.executionService.resolveAccessScope(user),
    );
    return {
      status: execution.status,
      result: execution.result,
    };
  }

  @Post(':id/import')
  @RequirePermissions(Permission.DATASETS)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  importPreview(
    @Param('id', ParseIntPipe) _id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      return Promise.reject(
        new HttpException('No file uploaded', HttpStatus.BAD_REQUEST),
      );
    }
    return Promise.resolve().then(() =>
      this.csvService.parsePreview(file.buffer),
    );
  }

  @Post(':id/import/confirm')
  @RequirePermissions(Permission.DATASETS)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async importConfirm(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportConfirmDto,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    const mappings =
      typeof dto.mappings === 'string'
        ? JSON.parse(dto.mappings)
        : dto.mappings;
    const skipFirstRow =
      dto.skipFirstRow !== 'false' && dto.skipFirstRow !== false;

    const records = this.csvService.parseAndMap(
      file.buffer,
      mappings,
      skipFirstRow,
    );
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
    const includeAnchors =
      includeAnchorsQuery === 'true' || includeAnchorsQuery === '1';
    const { filename, csv } = await this.datasetService.exportCsv(id, {
      includeAnchors,
    });

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
        const match = filterRegex.exec(key);
        if (!match) continue;
        if (
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          typeof value !== 'boolean'
        ) {
          throw new HttpException(
            'Filter value must be a scalar',
            HttpStatus.BAD_REQUEST,
          );
        }
        filters.push({
          field: match[1],
          operator: match[2] as RecordFilter['operator'],
          value: String(value),
        });
      }
    }

    return filters;
  }
}
