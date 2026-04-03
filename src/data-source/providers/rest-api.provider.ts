import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DataSourceProvider, DataSourceProviderResult } from '../data-source-provider.interface';

@Injectable()
export class RestApiProvider implements DataSourceProvider {
    readonly type = 'rest_api';
    readonly displayName = 'REST API';
    readonly description = 'Connect to any REST API with configurable pagination and authentication';
    readonly category = 'generic';
    readonly defaultIncrementalKey = null;

    readonly configSchema = {
        type: 'object',
        properties: {
            url: { type: 'string', title: 'Endpoint URL' },
            method: { type: 'string', title: 'HTTP Method', enum: ['GET', 'POST'], default: 'GET' },
            headers: { type: 'string', title: 'Extra headers (JSON)', description: '{"Accept": "application/json"}' },
            queryParams: { type: 'string', title: 'Query params (JSON)', description: '{"limit": 100}' },
            body: { type: 'string', title: 'Body (JSON, POST only)' },
            dataPath: { type: 'string', title: 'Data path', description: 'Dot notation to data array, e.g. "results" or "data.items"' },
            pagination: { type: 'string', title: 'Pagination type', enum: ['none', 'offset', 'page', 'cursor'], default: 'none' },
            paginationParam: { type: 'string', title: 'Pagination parameter name', description: 'e.g. "offset", "page", "cursor"' },
            pageSizeParam: { type: 'string', title: 'Page size parameter', description: 'e.g. "limit", "per_page"' },
            pageSize: { type: 'number', title: 'Records per page', default: 100 },
            totalPath: { type: 'string', title: 'Total records path', description: 'Dot notation, e.g. "meta.total"' },
            cursorPath: { type: 'string', title: 'Next cursor path', description: 'Dot notation, e.g. "meta.next_cursor"' },
        },
        required: ['url', 'dataPath'],
    };

    readonly credentialsSchema = {
        type: 'object',
        properties: {
            apiKey: { type: 'string', title: 'API Key' },
            apiKeyHeader: { type: 'string', title: 'API Key header name', default: 'X-API-Key' },
            bearerToken: { type: 'string', title: 'Bearer Token', description: 'Alternative to API Key' },
        },
    };

    constructor(private readonly httpService: HttpService) {}

    validateConfig(config: Record<string, any>): string[] {
        const errors: string[] = [];
        if (!config.url) errors.push('URL is required');
        if (!config.dataPath) errors.push('Data path is required');
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

    async fetch(config: Record<string, any>, credentials?: Record<string, any>, cursor?: string): Promise<DataSourceProviderResult> {
        const headers = this.buildHeaders(config, credentials);
        const allRecords: Record<string, any>[] = [];
        let currentCursor = cursor;
        let currentPage = 1;
        let currentOffset = 0;
        let hasMore = true;

        while (hasMore) {
            const params = this.buildParams(config, currentPage, currentOffset, currentCursor);
            const response = await this.makeRequest(config, headers, params);

            const records = this.extractData(response.data, config.dataPath);
            if (!Array.isArray(records) || records.length === 0) {
                hasMore = false;
                break;
            }

            allRecords.push(...records);

            if (config.pagination === 'none' || !config.pagination) {
                hasMore = false;
            } else if (config.pagination === 'cursor') {
                const nextCursor = config.cursorPath ? this.extractData(response.data, config.cursorPath) : null;
                if (!nextCursor) {
                    hasMore = false;
                } else {
                    currentCursor = nextCursor;
                }
            } else if (config.pagination === 'page') {
                const total = config.totalPath ? this.extractData(response.data, config.totalPath) : null;
                const pageSize = config.pageSize || 100;
                if (total && allRecords.length >= total) {
                    hasMore = false;
                } else if (records.length < pageSize) {
                    hasMore = false;
                } else {
                    currentPage++;
                }
            } else if (config.pagination === 'offset') {
                const total = config.totalPath ? this.extractData(response.data, config.totalPath) : null;
                const pageSize = config.pageSize || 100;
                currentOffset += pageSize;
                if (total && currentOffset >= total) {
                    hasMore = false;
                } else if (records.length < pageSize) {
                    hasMore = false;
                }
            }
        }

        return { records: allRecords };
    }

    private buildHeaders(config: Record<string, any>, credentials?: Record<string, any>): Record<string, string> {
        const headers: Record<string, string> = { 'Accept': 'application/json' };

        if (config.headers) {
            try {
                Object.assign(headers, JSON.parse(config.headers));
            } catch { /* ignore parse errors */ }
        }

        if (credentials?.bearerToken) {
            headers['Authorization'] = `Bearer ${credentials.bearerToken}`;
        } else if (credentials?.apiKey) {
            const headerName = credentials.apiKeyHeader || 'X-API-Key';
            headers[headerName] = credentials.apiKey;
        }

        return headers;
    }

    private buildParams(config: Record<string, any>, page: number, offset: number, cursor?: string): Record<string, any> {
        let params: Record<string, any> = {};

        if (config.queryParams) {
            try {
                params = JSON.parse(config.queryParams);
            } catch { /* ignore */ }
        }

        if (config.pagination === 'page' && config.paginationParam) {
            params[config.paginationParam] = page;
        } else if (config.pagination === 'offset' && config.paginationParam) {
            params[config.paginationParam] = offset;
        } else if (config.pagination === 'cursor' && config.paginationParam && cursor) {
            params[config.paginationParam] = cursor;
        }

        if (config.pageSizeParam && config.pageSize) {
            params[config.pageSizeParam] = config.pageSize;
        }

        return params;
    }

    private async makeRequest(config: Record<string, any>, headers: Record<string, string>, params: Record<string, any>) {
        const method = (config.method || 'GET').toUpperCase();

        if (method === 'POST') {
            let body = {};
            if (config.body) {
                try { body = JSON.parse(config.body); } catch { /* ignore */ }
            }
            return firstValueFrom(
                this.httpService.post(config.url, body, { headers, params, timeout: 30000 }),
            );
        }

        return firstValueFrom(
            this.httpService.get(config.url, { headers, params, timeout: 30000 }),
        );
    }

    private extractData(data: any, path: string): any {
        if (!path) return data;
        return path.split('.').reduce((curr, key) => curr?.[key], data);
    }
}
