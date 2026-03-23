import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatasetEntity } from './dataset.entity';
import { DatasetRecordEntity } from './dataset-record.entity';

export interface RecordFilter {
    field: string;
    operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
    value: string;
}

export interface QueryParams {
    filters?: RecordFilter[];
    search?: string;
    sort?: string;
    order?: 'asc' | 'desc';
    relatedTo?: number;
    relationId?: number;
    page?: number;
    limit?: number;
}

export interface AggregateParams {
    field: string;
    fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
    groupBy?: string;
}

@Injectable()
export class DatasetQueryService {
    constructor(
        @InjectRepository(DatasetEntity)
        private readonly datasetRepository: Repository<DatasetEntity>,
        @InjectRepository(DatasetRecordEntity)
        private readonly recordRepository: Repository<DatasetRecordEntity>,
    ) { }

    async queryRecords(datasetId: number, params: QueryParams): Promise<{ records: DatasetRecordEntity[]; total: number }> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        const page = params.page || 1;
        const limit = params.limit || 50;

        let qb = this.recordRepository.createQueryBuilder('record')
            .where('record.dataset_id = :datasetId', { datasetId });

        // Apply filters
        if (params.filters && params.filters.length > 0) {
            for (let i = 0; i < params.filters.length; i++) {
                const filter = params.filters[i];
                const field = this.validateFieldKey(dataset, filter.field);
                const fieldDef = dataset.schema.find(f => f.key === field);
                const paramName = `filter_${i}`;

                if (fieldDef && (fieldDef.type === 'number') && filter.operator !== 'contains') {
                    // Numeric comparison
                    const op = this.getSqlOperator(filter.operator);
                    qb.andWhere(`(record.data ->> :field_${i})::numeric ${op} :${paramName}`, {
                        [`field_${i}`]: field,
                        [paramName]: Number(filter.value),
                    });
                } else if (filter.operator === 'contains') {
                    qb.andWhere(`record.data ->> :field_${i} ILIKE :${paramName}`, {
                        [`field_${i}`]: field,
                        [paramName]: `%${filter.value}%`,
                    });
                } else {
                    // String equality
                    qb.andWhere(`record.data ->> :field_${i} = :${paramName}`, {
                        [`field_${i}`]: field,
                        [paramName]: filter.value,
                    });
                }
            }
        }

        // Apply search across all text fields
        if (params.search) {
            const textFields = dataset.schema.filter(f => f.type === 'text' || f.type === 'select');
            if (textFields.length > 0) {
                const conditions = textFields.map((f, i) =>
                    `record.data ->> :search_field_${i} ILIKE :search_term`
                );
                const searchParams: Record<string, any> = { search_term: `%${params.search}%` };
                textFields.forEach((f, i) => {
                    searchParams[`search_field_${i}`] = f.key;
                });
                qb.andWhere(`(${conditions.join(' OR ')})`, searchParams);
            }
        }

        // Apply related-to filter
        if (params.relatedTo && params.relationId) {
            qb.andWhere(`record.id IN (
                SELECT drl.target_record_id FROM dataset_record_links drl
                WHERE drl.relation_id = :relationId AND drl.source_record_id = :relatedTo
                UNION
                SELECT drl.source_record_id FROM dataset_record_links drl
                WHERE drl.relation_id = :relationId AND drl.target_record_id = :relatedTo
            )`, { relatedTo: params.relatedTo, relationId: params.relationId });
        }

        // Apply sorting
        if (params.sort) {
            const sortField = this.validateFieldKey(dataset, params.sort);
            const sortFieldDef = dataset.schema.find(f => f.key === sortField);
            const direction = (params.order || 'asc').toUpperCase() as 'ASC' | 'DESC';

            if (sortFieldDef && sortFieldDef.type === 'number') {
                qb.orderBy(`(record.data ->> '${sortField}')::numeric`, direction);
            } else {
                qb.orderBy(`record.data ->> '${sortField}'`, direction);
            }
        } else {
            qb.orderBy('record.created_at', 'DESC');
        }

        const total = await qb.getCount();
        const records = await qb.skip((page - 1) * limit).take(limit).getMany();

        return { records, total };
    }

    async aggregate(datasetId: number, params: AggregateParams): Promise<any[]> {
        const dataset = await this.datasetRepository.findOne({ where: { id: datasetId } });
        if (!dataset) {
            throw new NotFoundException(`Dataset with id ${datasetId} not found`);
        }

        const field = this.validateFieldKey(dataset, params.field);
        const fn = this.validateAggregateFunction(params.fn);

        let query: string;
        const queryParams: any[] = [datasetId];

        if (params.groupBy) {
            const groupField = this.validateFieldKey(dataset, params.groupBy);

            if (fn === 'count') {
                query = `SELECT data->>'${groupField}' as "group", COUNT(*)::integer as "value"
                         FROM dataset_records WHERE dataset_id = $1
                         GROUP BY data->>'${groupField}'
                         ORDER BY "value" DESC`;
            } else {
                query = `SELECT data->>'${groupField}' as "group", ${fn}((data->>'${field}')::numeric) as "value"
                         FROM dataset_records WHERE dataset_id = $1
                         GROUP BY data->>'${groupField}'
                         ORDER BY "value" DESC`;
            }
        } else {
            if (fn === 'count') {
                query = `SELECT COUNT(*)::integer as "value"
                         FROM dataset_records WHERE dataset_id = $1`;
            } else {
                query = `SELECT ${fn}((data->>'${field}')::numeric) as "value"
                         FROM dataset_records WHERE dataset_id = $1`;
            }
        }

        return await this.recordRepository.query(query, queryParams);
    }

    private validateFieldKey(dataset: DatasetEntity, key: string): string {
        const validKeys = dataset.schema.map(f => f.key);
        if (!validKeys.includes(key)) {
            throw new BadRequestException(`Invalid field key: "${key}". Valid keys: ${validKeys.join(', ')}`);
        }
        return key;
    }

    private validateAggregateFunction(fn: string): string {
        const valid = ['count', 'sum', 'avg', 'min', 'max'];
        if (!valid.includes(fn)) {
            throw new BadRequestException(`Invalid aggregate function: "${fn}". Valid: ${valid.join(', ')}`);
        }
        return fn.toUpperCase();
    }

    private getSqlOperator(op: string): string {
        switch (op) {
            case 'eq': return '=';
            case 'gt': return '>';
            case 'gte': return '>=';
            case 'lt': return '<';
            case 'lte': return '<=';
            default: return '=';
        }
    }
}
