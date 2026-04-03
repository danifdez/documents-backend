import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DataSourceProvider, DataSourceProviderResult } from '../data-source-provider.interface';

@Injectable()
export class EurostatProvider implements DataSourceProvider {
    readonly type = 'eurostat';
    readonly displayName = 'Eurostat';
    readonly description = 'European Union statistics on economy, population, trade, and more';
    readonly category = 'government';
    readonly defaultIncrementalKey = 'time';

    readonly configSchema = {
        type: 'object',
        properties: {
            datasetCode: { type: 'string', title: 'Dataset code', description: 'e.g. nama_10_gdp (GDP), demo_pjan (Population), une_rt_m (Unemployment)' },
            geo: { type: 'string', title: 'Country/Countries', description: 'Comma-separated codes: ES,FR,DE or empty for all' },
            timePeriod: { type: 'string', title: 'Time period', description: 'e.g. 2015..2024' },
            filters: { type: 'string', title: 'Additional filters (JSON)', description: '{"unit": "CP_MEUR", "na_item": "B1GQ"}' },
        },
        required: ['datasetCode'],
    };

    readonly credentialsSchema = null;

    constructor(private readonly httpService: HttpService) {}

    validateConfig(config: Record<string, any>): string[] {
        const errors: string[] = [];
        if (!config.datasetCode) errors.push('Dataset code is required');
        return errors;
    }

    async testConnection(config: Record<string, any>): Promise<{ success: boolean; message: string; sampleData?: any[] }> {
        try {
            const result = await this.fetch(config);
            return {
                success: true,
                message: `Fetched ${result.records.length} records from Eurostat`,
                sampleData: result.records.slice(0, 5),
            };
        } catch (err) {
            return { success: false, message: `Connection failed: ${err.message}` };
        }
    }

    async fetch(config: Record<string, any>): Promise<DataSourceProviderResult> {
        const params: Record<string, any> = {
            format: 'JSON',
            lang: 'en',
        };

        if (config.geo) {
            params.geo = config.geo;
        }
        if (config.timePeriod) {
            params.time = config.timePeriod;
        }

        // Apply additional filters
        if (config.filters) {
            try {
                const extra = JSON.parse(config.filters);
                Object.assign(params, extra);
            } catch { /* ignore parse errors */ }
        }

        const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${config.datasetCode}`;
        const response = await firstValueFrom(
            this.httpService.get(url, { params, timeout: 60000 }),
        );

        const data = response.data;
        const records = this.parseJsonStat(data);

        return { records };
    }

    private parseJsonStat(data: any): Record<string, any>[] {
        if (!data || !data.dimension || !data.id || !data.size) {
            return [];
        }

        const dimensionIds: string[] = data.id;
        const sizes: number[] = data.size;
        const values = data.value || {};

        // Build dimension label maps
        const dimensionLabels: Map<number, string>[] = dimensionIds.map(dimId => {
            const dim = data.dimension[dimId];
            const category = dim?.category;
            if (!category?.index || !category?.label) return new Map();

            const indexMap = new Map<number, string>();
            for (const [code, idx] of Object.entries(category.index)) {
                const label = category.label[code] || code;
                indexMap.set(idx as number, label);
            }
            return indexMap;
        });

        const dimensionCodes: Map<number, string>[] = dimensionIds.map(dimId => {
            const dim = data.dimension[dimId];
            const category = dim?.category;
            if (!category?.index) return new Map();

            const codeMap = new Map<number, string>();
            for (const [code, idx] of Object.entries(category.index)) {
                codeMap.set(idx as number, code);
            }
            return codeMap;
        });

        // Generate all combinations
        const records: Record<string, any>[] = [];
        const totalCombinations = sizes.reduce((a, b) => a * b, 1);

        for (let flatIndex = 0; flatIndex < totalCombinations; flatIndex++) {
            const value = values[flatIndex] ?? values[String(flatIndex)];
            if (value === null || value === undefined) continue;

            const record: Record<string, any> = {};
            let remaining = flatIndex;

            for (let d = dimensionIds.length - 1; d >= 0; d--) {
                const dimIndex = remaining % sizes[d];
                remaining = Math.floor(remaining / sizes[d]);

                const dimName = dimensionIds[d];
                record[dimName] = dimensionCodes[d]?.get(dimIndex) || String(dimIndex);
                record[`${dimName}_label`] = dimensionLabels[d]?.get(dimIndex) || record[dimName];
            }

            record.value = value;
            records.push(record);
        }

        return records;
    }
}
