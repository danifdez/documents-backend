import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DataSourceProvider, DataSourceProviderResult } from '../data-source-provider.interface';

@Injectable()
export class WorldBankProvider implements DataSourceProvider {
    readonly type = 'world_bank';
    readonly displayName = 'World Bank Open Data';
    readonly description = '16,000+ global economic indicators (GDP, population, literacy, etc.)';
    readonly category = 'government';
    readonly defaultIncrementalKey = 'year';

    readonly configSchema = {
        type: 'object',
        properties: {
            indicator: { type: 'string', title: 'Indicator code', description: 'e.g. NY.GDP.MKTP.CD (GDP), SP.POP.TOTL (Population), SE.ADT.LITR.ZS (Literacy)' },
            country: { type: 'string', title: 'Country/Region', default: 'all', description: 'ISO3 code (ESP, USA, BRA) or "all" for all countries' },
            dateRange: { type: 'string', title: 'Year range', default: '2000:2024', description: 'Format: start:end (e.g. 2000:2024)' },
        },
        required: ['indicator'],
    };

    readonly credentialsSchema = null;

    constructor(private readonly httpService: HttpService) {}

    validateConfig(config: Record<string, any>): string[] {
        const errors: string[] = [];
        if (!config.indicator) errors.push('Indicator code is required');
        return errors;
    }

    async testConnection(config: Record<string, any>): Promise<{ success: boolean; message: string; sampleData?: any[] }> {
        try {
            const result = await this.fetchPage(config, 1, 5);
            return {
                success: true,
                message: `Found ${result.total} records for indicator ${config.indicator}`,
                sampleData: result.records.slice(0, 5),
            };
        } catch (err) {
            return { success: false, message: `Connection failed: ${err.message}` };
        }
    }

    async fetch(config: Record<string, any>): Promise<DataSourceProviderResult> {
        const allRecords: Record<string, any>[] = [];
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages) {
            const result = await this.fetchPage(config, page, 1000);
            allRecords.push(...result.records);
            totalPages = result.totalPages;
            page++;
        }

        return {
            records: allRecords,
            schema: [
                { key: 'country', name: 'Country', type: 'text', required: false },
                { key: 'country_code', name: 'Country Code', type: 'text', required: false },
                { key: 'year', name: 'Year', type: 'number', required: false },
                { key: 'value', name: 'Value', type: 'number', required: false },
                { key: 'indicator', name: 'Indicator', type: 'text', required: false },
            ],
        };
    }

    private async fetchPage(config: Record<string, any>, page: number, perPage: number): Promise<{ records: Record<string, any>[]; totalPages: number; total: number }> {
        const country = config.country || 'all';
        const dateRange = config.dateRange || '2000:2024';

        const url = `https://api.worldbank.org/v2/country/${country}/indicator/${config.indicator}`;
        const response = await firstValueFrom(
            this.httpService.get(url, {
                params: {
                    date: dateRange,
                    format: 'json',
                    per_page: perPage,
                    page,
                },
                timeout: 30000,
            }),
        );

        const data = response.data;
        if (!Array.isArray(data) || data.length < 2) {
            return { records: [], totalPages: 0, total: 0 };
        }

        const metadata = data[0];
        const items = data[1] || [];

        const records = items
            .filter((item: any) => item.value !== null)
            .map((item: any) => ({
                country: item.country?.value,
                country_code: item.countryiso3code,
                year: Number(item.date),
                value: Number(item.value),
                indicator: item.indicator?.value,
            }));

        return {
            records,
            totalPages: metadata.pages || 1,
            total: metadata.total || 0,
        };
    }
}
