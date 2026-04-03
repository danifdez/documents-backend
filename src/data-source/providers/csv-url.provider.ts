import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DataSourceProvider, DataSourceProviderResult } from '../data-source-provider.interface';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parse } = require('csv-parse/sync');

@Injectable()
export class CsvUrlProvider implements DataSourceProvider {
    readonly type = 'csv_url';
    readonly displayName = 'CSV / JSON URL';
    readonly description = 'Import data from any public or private URL returning CSV or JSON';
    readonly category = 'generic';
    readonly defaultIncrementalKey = null;

    readonly configSchema = {
        type: 'object',
        properties: {
            url: { type: 'string', title: 'URL', description: 'Direct URL to the CSV or JSON file' },
            format: { type: 'string', title: 'Format', enum: ['csv', 'json'], default: 'csv' },
            jsonDataPath: { type: 'string', title: 'JSON data path', description: 'Dot notation to the data array (e.g. "response.data.items"). Leave empty if root is the array' },
            csvDelimiter: { type: 'string', title: 'CSV delimiter', default: ',', enum: [',', ';', '\t', '|'] },
            encoding: { type: 'string', title: 'Encoding', default: 'utf-8', enum: ['utf-8', 'iso-8859-1', 'windows-1252'] },
        },
        required: ['url', 'format'],
    };

    readonly credentialsSchema = {
        type: 'object',
        properties: {
            authHeader: { type: 'string', title: 'Authorization header', description: 'e.g. Bearer xxx or Basic xxx (optional)' },
        },
    };

    constructor(private readonly httpService: HttpService) {}

    validateConfig(config: Record<string, any>): string[] {
        const errors: string[] = [];
        if (!config.url) errors.push('URL is required');
        if (!config.format || !['csv', 'json'].includes(config.format)) errors.push('Format must be csv or json');
        return errors;
    }

    async testConnection(config: Record<string, any>, credentials?: Record<string, any>): Promise<{ success: boolean; message: string; sampleData?: any[] }> {
        try {
            const result = await this.fetch(config, credentials);
            return {
                success: true,
                message: `Successfully fetched ${result.records.length} records`,
                sampleData: result.records.slice(0, 5),
            };
        } catch (err) {
            return { success: false, message: `Connection failed: ${err.message}` };
        }
    }

    async fetch(config: Record<string, any>, credentials?: Record<string, any>): Promise<DataSourceProviderResult> {
        const headers: Record<string, string> = {};
        if (credentials?.authHeader) {
            headers['Authorization'] = credentials.authHeader;
        }

        const isCsv = config.format === 'csv';
        const response = await firstValueFrom(
            this.httpService.get(config.url, {
                headers,
                responseType: isCsv ? 'text' : 'json',
                timeout: 30000,
            }),
        );

        if (isCsv) {
            return this.parseCsv(response.data, config.csvDelimiter || ',');
        } else {
            return this.parseJson(response.data, config.jsonDataPath);
        }
    }

    private parseCsv(data: string, delimiter: string): DataSourceProviderResult {
        const allRows: string[][] = parse(data, {
            skip_empty_lines: true,
            relax_column_count: true,
            delimiter,
        });

        if (allRows.length < 2) {
            return { records: [] };
        }

        const headers = allRows[0];
        const records = allRows.slice(1).map(row => {
            const record: Record<string, any> = {};
            headers.forEach((header, i) => {
                record[header] = row[i] ?? null;
            });
            return record;
        });

        return { records };
    }

    private parseJson(data: any, dataPath?: string): DataSourceProviderResult {
        let records: any[];

        if (dataPath) {
            records = dataPath.split('.').reduce((curr, key) => curr?.[key], data);
        } else {
            records = data;
        }

        if (!Array.isArray(records)) {
            throw new Error(`Expected an array at path "${dataPath || 'root'}", got ${typeof records}`);
        }

        return { records };
    }
}
