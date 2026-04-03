import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatasetEntity, DatasetField } from './dataset.entity';
import { DatasetRecordEntity } from './dataset-record.entity';
import { DatasetRelationEntity } from './dataset-relation.entity';
import { DatasetRecordLinkEntity } from './dataset-record-link.entity';
import { DatasetChartEntity } from './dataset-chart.entity';
import { CreateDatasetDto, UpdateDatasetDto, CreateDatasetRecordDto, UpdateDatasetRecordDto, CreateDatasetRelationDto, LinkRecordsDto, CreateDatasetChartDto, UpdateDatasetChartDto } from './dto/dataset.dto';

@Injectable()
export class DatasetService {
    constructor(
        @InjectRepository(DatasetEntity)
        private readonly datasetRepository: Repository<DatasetEntity>,
        @InjectRepository(DatasetRecordEntity)
        private readonly recordRepository: Repository<DatasetRecordEntity>,
        @InjectRepository(DatasetRelationEntity)
        private readonly relationRepository: Repository<DatasetRelationEntity>,
        @InjectRepository(DatasetRecordLinkEntity)
        private readonly linkRepository: Repository<DatasetRecordLinkEntity>,
        @InjectRepository(DatasetChartEntity)
        private readonly chartRepository: Repository<DatasetChartEntity>,
    ) { }

    async findAllDatasets(projectId?: number): Promise<any[]> {
        const qb = this.datasetRepository.createQueryBuilder('dataset')
            .leftJoinAndSelect('dataset.project', 'project')
            .loadRelationCountAndMap('dataset.recordCount', 'dataset.records');

        if (projectId) {
            qb.where('dataset.project.id = :projectId', { projectId });
        }

        qb.orderBy('dataset.name', 'ASC');
        return await qb.getMany();
    }

    async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
        if (!searchTerm || searchTerm.trim() === '') return [];
        const like = `%${searchTerm}%`;
        const qb = this.datasetRepository
            .createQueryBuilder('d')
            .select(['d.id', 'd.name', 'd.description'])
            .addSelect('similarity(unaccent(d.name), unaccent(:s))', 'score')
            .where('unaccent(d.name) ILIKE unaccent(:q) OR unaccent(d.description) ILIKE unaccent(:q)', { q: like })
            .setParameter('s', searchTerm);
        if (projectId) {
            qb.andWhere('d.project_id = :projectId', { projectId });
        }
        return await qb.orderBy('score', 'DESC').limit(50).getRawMany();
    }

    async findOneDataset(id: number): Promise<DatasetEntity | null> {
        return await this.datasetRepository.findOne({
            where: { id },
            relations: ['project'],
        });
    }

    async createDataset(dto: CreateDatasetDto): Promise<DatasetEntity> {
        const dataset = this.datasetRepository.create({
            name: dto.name,
            description: dto.description || null,
            schema: dto.schema as DatasetField[],
        });

        if (dto.projectId) {
            dataset.project = { id: dto.projectId } as any;
        }

        return await this.datasetRepository.save(dataset);
    }

    async updateDataset(id: number, dto: UpdateDatasetDto): Promise<DatasetEntity> {
        const dataset = await this.datasetRepository.findOne({ where: { id } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${id} not found`);
        }

        if (dto.name !== undefined) dataset.name = dto.name;
        if (dto.description !== undefined) dataset.description = dto.description || null;
        if (dto.schema !== undefined) dataset.schema = dto.schema as DatasetField[];
        if (dto.projectId !== undefined) {
            dataset.project = dto.projectId ? { id: dto.projectId } as any : null;
        }

        return await this.datasetRepository.save(dataset);
    }

    async analyzeSchemaChange(id: number, newSchema: DatasetField[]): Promise<{
        removedFields: { key: string; name: string; affectedRecords: number }[];
        typeChanges: { key: string; name: string; oldType: string; newType: string; incompatibleRecords: number }[];
        safe: boolean;
    }> {
        const dataset = await this.datasetRepository.findOne({ where: { id } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${id} not found`);
        }

        const oldSchema = dataset.schema;
        const newKeys = new Set(newSchema.map(f => f.key));
        const oldFieldMap = new Map(oldSchema.map(f => [f.key, f]));

        const removedFields: { key: string; name: string; affectedRecords: number }[] = [];
        const typeChanges: { key: string; name: string; oldType: string; newType: string; incompatibleRecords: number }[] = [];

        // Detect removed fields
        for (const oldField of oldSchema) {
            if (!newKeys.has(oldField.key)) {
                const count = await this.recordRepository.createQueryBuilder('record')
                    .where('record.dataset_id = :datasetId', { datasetId: id })
                    .andWhere(`record.data ? :key`, { key: oldField.key })
                    .andWhere(`record.data ->> :key IS NOT NULL`, { key: oldField.key })
                    .andWhere(`record.data ->> :key != ''`, { key: oldField.key })
                    .getCount();

                if (count > 0) {
                    removedFields.push({
                        key: oldField.key,
                        name: oldField.name,
                        affectedRecords: count,
                    });
                }
            }
        }

        // Detect type changes
        for (const newField of newSchema) {
            const oldField = oldFieldMap.get(newField.key);
            if (oldField && oldField.type !== newField.type) {
                const incompatible = await this.countIncompatibleRecords(id, newField.key, newField.type);
                typeChanges.push({
                    key: newField.key,
                    name: newField.name,
                    oldType: oldField.type,
                    newType: newField.type,
                    incompatibleRecords: incompatible,
                });
            }
        }

        return {
            removedFields,
            typeChanges,
            safe: removedFields.length === 0 && typeChanges.length === 0,
        };
    }

    private async countIncompatibleRecords(datasetId: number, fieldKey: string, newType: string): Promise<number> {
        const records = await this.recordRepository.find({
            where: { dataset: { id: datasetId } },
            select: ['id', 'data'],
        });

        let incompatible = 0;
        for (const record of records) {
            const value = record.data[fieldKey];
            if (value === undefined || value === null || value === '') continue;

            if (!this.isValueCompatible(value, newType)) {
                incompatible++;
            }
        }
        return incompatible;
    }

    private isValueCompatible(value: any, targetType: string): boolean {
        const str = String(value);
        switch (targetType) {
            case 'number':
                return !isNaN(Number(value));
            case 'boolean':
                return typeof value === 'boolean' || value === 'true' || value === 'false';
            case 'date':
            case 'datetime':
                return !isNaN(Date.parse(str));
            case 'time':
                return /^\d{2}:\d{2}(:\d{2})?$/.test(str);
            case 'text':
                return true;
            case 'select':
                return true; // options validation happens separately
            default:
                return true;
        }
    }

    async removeDataset(id: number): Promise<void> {
        const dataset = await this.datasetRepository.findOne({ where: { id } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${id} not found`);
        }
        await this.datasetRepository.delete({ id });
    }

    async createFromCsv(
        name: string,
        schema: DatasetField[],
        records: Record<string, any>[],
        projectId?: number,
    ): Promise<{ dataset: DatasetEntity; imported: number; errors: { row: number; messages: string[] }[] }> {
        const dataset = this.datasetRepository.create({
            name,
            description: null,
            schema,
        });
        if (projectId) {
            dataset.project = { id: projectId } as any;
        }
        const savedDataset = await this.datasetRepository.save(dataset);

        const imported: DatasetRecordEntity[] = [];
        const errors: { row: number; messages: string[] }[] = [];

        for (let i = 0; i < records.length; i++) {
            const validationErrors = this.validateRecordData(schema, records[i]);
            if (validationErrors.length > 0) {
                errors.push({ row: i + 1, messages: validationErrors });
            } else {
                imported.push(this.recordRepository.create({
                    dataset: { id: savedDataset.id } as any,
                    data: this.cleanRecordData(schema, records[i]),
                }));
            }
        }

        if (imported.length > 0) {
            await this.recordRepository.save(imported, { chunk: 100 });
        }

        return { dataset: savedDataset, imported: imported.length, errors };
    }

    async resolveLinkedRecords(datasetId: number, values: (string | number)[], lookupField?: string): Promise<Record<string, Record<string, any>>> {
        if (!values.length) return {};
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) return {};

        let records: DatasetRecordEntity[];

        if (lookupField) {
            // Lookup by a field inside the JSONB data column
            const strValues = values.map(v => String(v));
            records = await this.recordRepository
                .createQueryBuilder('r')
                .where('r.dataset_id = :datasetId', { datasetId })
                .andWhere(`r.data ->> :field IN (:...vals)`, { field: lookupField, vals: strValues })
                .getMany();

            const map: Record<string, Record<string, any>> = {};
            for (const r of records) {
                const key = String(r.data[lookupField]);
                map[key] = r.data;
            }
            return map;
        } else {
            // Lookup by record PK
            const numIds = values.map(v => Number(v)).filter(n => !isNaN(n));
            if (!numIds.length) return {};
            records = await this.recordRepository
                .createQueryBuilder('r')
                .where('r.dataset_id = :datasetId', { datasetId })
                .andWhere('r.id IN (:...ids)', { ids: numIds })
                .getMany();

            const map: Record<string, Record<string, any>> = {};
            for (const r of records) {
                map[String(r.id)] = r.data;
            }
            return map;
        }
    }

    async findRecords(datasetId: number, page: number = 1, limit: number = 50): Promise<{ records: DatasetRecordEntity[]; total: number }> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        const [records, total] = await this.recordRepository.findAndCount({
            where: { dataset: { id: datasetId } },
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return { records, total };
    }

    async createRecord(datasetId: number, dto: CreateDatasetRecordDto): Promise<DatasetRecordEntity> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        const errors = this.validateRecordData(dataset.schema, dto.data);
        if (errors.length > 0) {
            throw new BadRequestException(errors);
        }

        const cleanData = this.cleanRecordData(dataset.schema, dto.data);
        const record = this.recordRepository.create({
            dataset: { id: datasetId } as any,
            data: cleanData,
        });

        return await this.recordRepository.save(record);
    }

    async updateRecord(datasetId: number, recordId: number, dto: UpdateDatasetRecordDto): Promise<DatasetRecordEntity> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        const record = await this.recordRepository.findOne({
            where: { id: recordId, dataset: { id: datasetId } },
        });
        if (!record) {
            throw new NotFoundException(`Record with id ${recordId} not found`);
        }

        const errors = this.validateRecordData(dataset.schema, dto.data);
        if (errors.length > 0) {
            throw new BadRequestException(errors);
        }

        record.data = this.cleanRecordData(dataset.schema, dto.data);
        return await this.recordRepository.save(record);
    }

    async removeRecord(datasetId: number, recordId: number): Promise<void> {
        const record = await this.recordRepository.findOne({
            where: { id: recordId, dataset: { id: datasetId } },
        });
        if (!record) {
            throw new NotFoundException(`Record with id ${recordId} not found`);
        }
        await this.recordRepository.delete({ id: recordId });
    }

    async findRelations(datasetId: number): Promise<DatasetRelationEntity[]> {
        return await this.relationRepository.find({
            where: [
                { sourceDataset: { id: datasetId } },
                { targetDataset: { id: datasetId } },
            ],
            relations: ['sourceDataset', 'targetDataset'],
        });
    }

    async createRelation(dto: CreateDatasetRelationDto): Promise<DatasetRelationEntity> {
        const source = await this.datasetRepository.findOne({ where: { id: dto.sourceDatasetId } });
        if (!source) {
            throw new NotFoundException(`Source dataset with id ${dto.sourceDatasetId} not found`);
        }

        const target = await this.datasetRepository.findOne({ where: { id: dto.targetDatasetId } });
        if (!target) {
            throw new NotFoundException(`Target dataset with id ${dto.targetDatasetId} not found`);
        }

        const relation = this.relationRepository.create({
            name: dto.name || null,
            sourceDataset: { id: dto.sourceDatasetId } as any,
            targetDataset: { id: dto.targetDatasetId } as any,
            relationType: dto.relationType,
        });

        return await this.relationRepository.save(relation);
    }

    async removeRelation(relationId: number): Promise<void> {
        const relation = await this.relationRepository.findOne({ where: { id: relationId } });
        if (!relation) {
            throw new NotFoundException(`Relation with id ${relationId} not found`);
        }
        await this.relationRepository.delete({ id: relationId });
    }

    async linkRecords(relationId: number, dto: LinkRecordsDto): Promise<DatasetRecordLinkEntity> {
        const relation = await this.relationRepository.findOne({
            where: { id: relationId },
            relations: ['sourceDataset', 'targetDataset'],
        });
        if (!relation) {
            throw new NotFoundException(`Relation with id ${relationId} not found`);
        }

        const sourceRecord = await this.recordRepository.findOne({
            where: { id: dto.sourceRecordId },
            relations: ['dataset'],
        });
        if (!sourceRecord || sourceRecord.dataset.id !== relation.sourceDataset.id) {
            throw new BadRequestException('Source record does not belong to the source dataset of this relation');
        }

        const targetRecord = await this.recordRepository.findOne({
            where: { id: dto.targetRecordId },
            relations: ['dataset'],
        });
        if (!targetRecord || targetRecord.dataset.id !== relation.targetDataset.id) {
            throw new BadRequestException('Target record does not belong to the target dataset of this relation');
        }

        const link = this.linkRepository.create({
            relation: { id: relationId } as any,
            sourceRecord: { id: dto.sourceRecordId } as any,
            targetRecord: { id: dto.targetRecordId } as any,
        });

        return await this.linkRepository.save(link);
    }

    async unlinkRecords(relationId: number, linkId: number): Promise<void> {
        const link = await this.linkRepository.findOne({
            where: { id: linkId, relation: { id: relationId } },
        });
        if (!link) {
            throw new NotFoundException(`Link with id ${linkId} not found`);
        }
        await this.linkRepository.delete({ id: linkId });
    }

    async getLinkedRecords(datasetId: number, recordId: number): Promise<any[]> {
        const links = await this.linkRepository.createQueryBuilder('link')
            .leftJoinAndSelect('link.relation', 'relation')
            .leftJoinAndSelect('relation.sourceDataset', 'sourceDataset')
            .leftJoinAndSelect('relation.targetDataset', 'targetDataset')
            .leftJoinAndSelect('link.sourceRecord', 'sourceRecord')
            .leftJoinAndSelect('link.targetRecord', 'targetRecord')
            .where('link.sourceRecord.id = :recordId', { recordId })
            .orWhere('link.targetRecord.id = :recordId', { recordId })
            .getMany();

        return links.map(link => {
            const isSource = link.sourceRecord.id === recordId;
            return {
                linkId: link.id,
                relation: {
                    id: link.relation.id,
                    name: link.relation.name,
                    relationType: link.relation.relationType,
                },
                linkedRecord: isSource ? link.targetRecord : link.sourceRecord,
                linkedDataset: isSource ? link.relation.targetDataset : link.relation.sourceDataset,
                direction: isSource ? 'outgoing' : 'incoming',
            };
        });
    }

    validateRecordData(schema: DatasetField[], data: Record<string, any>): string[] {
        const errors: string[] = [];

        for (const field of schema) {
            const value = data[field.key];

            if (field.required && (value === undefined || value === null || value === '')) {
                errors.push(`Field "${field.name}" is required`);
                continue;
            }

            if (value === undefined || value === null || value === '') {
                continue;
            }

            switch (field.type) {
                case 'number':
                    if (isNaN(Number(value))) {
                        errors.push(`Field "${field.name}" must be a valid number`);
                    }
                    break;
                case 'boolean':
                    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
                        errors.push(`Field "${field.name}" must be a boolean`);
                    }
                    break;
                case 'date':
                    if (isNaN(Date.parse(String(value)))) {
                        errors.push(`Field "${field.name}" must be a valid date`);
                    }
                    break;
                case 'datetime':
                    if (isNaN(Date.parse(String(value)))) {
                        errors.push(`Field "${field.name}" must be a valid datetime`);
                    }
                    break;
                case 'time':
                    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(value))) {
                        errors.push(`Field "${field.name}" must be a valid time (HH:mm or HH:mm:ss)`);
                    }
                    break;
                case 'select':
                    if (field.options && !field.options.includes(String(value))) {
                        errors.push(`Field "${field.name}" must be one of: ${field.options.join(', ')}`);
                    }
                    break;
            }
        }

        return errors;
    }

    private cleanRecordData(schema: DatasetField[], data: Record<string, any>): Record<string, any> {
        const clean: Record<string, any> = {};
        const validKeys = new Set(schema.map(f => f.key));

        for (const [key, value] of Object.entries(data)) {
            if (!validKeys.has(key)) continue;

            const field = schema.find(f => f.key === key);
            if (!field || value === undefined || value === null || value === '') {
                if (value === '' || value === null) clean[key] = null;
                continue;
            }

            switch (field.type) {
                case 'number':
                    clean[key] = Number(value);
                    break;
                case 'boolean':
                    clean[key] = value === true || value === 'true';
                    break;
                default:
                    clean[key] = value;
            }
        }

        return clean;
    }

    async bulkDeleteRecords(datasetId: number, recordIds: number[]): Promise<{ deleted: number }> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        if (!recordIds.length) return { deleted: 0 };

        const result = await this.recordRepository.createQueryBuilder()
            .delete()
            .where('dataset_id = :datasetId', { datasetId })
            .andWhere('id IN (:...ids)', { ids: recordIds })
            .execute();

        return { deleted: result.affected || 0 };
    }

    async findAllRecords(datasetId: number): Promise<DatasetRecordEntity[]> {
        return await this.recordRepository.find({
            where: { dataset: { id: datasetId } },
            order: { createdAt: 'DESC' },
        });
    }

    // ── Chart CRUD ──

    async findCharts(datasetId: number): Promise<DatasetChartEntity[]> {
        return await this.chartRepository.find({
            where: { dataset: { id: datasetId } },
            order: { updatedAt: 'DESC' },
        });
    }

    async findOneChart(chartId: number): Promise<DatasetChartEntity | null> {
        return await this.chartRepository.findOne({
            where: { id: chartId },
            relations: ['dataset'],
        });
    }

    async createChart(datasetId: number, dto: CreateDatasetChartDto): Promise<DatasetChartEntity> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        const chart = this.chartRepository.create({
            dataset: { id: datasetId } as any,
            name: dto.name,
            config: dto.config,
        });

        return await this.chartRepository.save(chart);
    }

    async updateChart(chartId: number, dto: UpdateDatasetChartDto): Promise<DatasetChartEntity> {
        const chart = await this.chartRepository.findOne({ where: { id: chartId } });
        if (!chart) {
            throw new NotFoundException(`Chart with id ${chartId} not found`);
        }

        if (dto.name !== undefined) chart.name = dto.name;
        if (dto.config !== undefined) chart.config = dto.config;

        return await this.chartRepository.save(chart);
    }

    async removeChart(chartId: number): Promise<void> {
        const chart = await this.chartRepository.findOne({ where: { id: chartId } });
        if (!chart) {
            throw new NotFoundException(`Chart with id ${chartId} not found`);
        }
        await this.chartRepository.delete({ id: chartId });
    }

    async bulkCreateRecords(datasetId: number, records: Record<string, any>[]): Promise<{ imported: number; errors: { row: number; messages: string[] }[] }> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        const imported: DatasetRecordEntity[] = [];
        const errors: { row: number; messages: string[] }[] = [];

        for (let i = 0; i < records.length; i++) {
            const validationErrors = this.validateRecordData(dataset.schema, records[i]);
            if (validationErrors.length > 0) {
                errors.push({ row: i + 1, messages: validationErrors });
            } else {
                imported.push(this.recordRepository.create({
                    dataset: { id: datasetId } as any,
                    data: this.cleanRecordData(dataset.schema, records[i]),
                }));
            }
        }

        if (imported.length > 0) {
            await this.recordRepository.save(imported, { chunk: 100 });
        }

        return { imported: imported.length, errors };
    }
}
