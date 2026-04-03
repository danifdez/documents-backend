import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DataSourceProvider, DataSourceProviderResult } from '../data-source-provider.interface';

@Injectable()
export class FredProvider implements DataSourceProvider {
    readonly type = 'fred';
    readonly displayName = 'FRED (Federal Reserve)';
    readonly description = '800,000+ US and international economic time series';
    readonly category = 'finance';
    readonly defaultIncrementalKey = 'date';

    readonly configSchema = {
        type: 'object',
        properties: {
            seriesId: { type: 'string', title: 'Series ID', description: 'e.g. GDP, UNRATE, CPIAUCSL, DFF, SP500' },
            observationStart: { type: 'string', title: 'Start date', description: 'YYYY-MM-DD' },
            observationEnd: { type: 'string', title: 'End date', description: 'YYYY-MM-DD' },
            frequency: { type: 'string', title: 'Frequency', enum: ['d', 'w', 'm', 'q', 'a'], default: 'm', description: 'daily, weekly, monthly, quarterly, annual' },
            units: { type: 'string', title: 'Units', enum: ['lin', 'chg', 'ch1', 'pch', 'pc1', 'pca', 'log'], default: 'lin', description: 'lin=levels, pch=% change, etc.' },
        },
        required: ['seriesId'],
    };

    readonly credentialsSchema = {
        type: 'object',
        properties: {
            apiKey: { type: 'string', title: 'API Key', description: 'Get free at fred.stlouisfed.org/docs/api/api_key.html' },
        },
        required: ['apiKey'],
    };

    constructor(private readonly httpService: HttpService) {}

    validateConfig(config: Record<string, any>): string[] {
        const errors: string[] = [];
        if (!config.seriesId) errors.push('Series ID is required');
        return errors;
    }

    async testConnection(config: Record<string, any>, credentials?: Record<string, any>): Promise<{ success: boolean; message: string; sampleData?: any[] }> {
        if (!credentials?.apiKey) {
            return { success: false, message: 'API Key is required' };
        }
        try {
            const result = await this.fetch(config, credentials);
            return {
                success: true,
                message: `Fetched ${result.records.length} observations for ${config.seriesId}`,
                sampleData: result.records.slice(0, 5),
            };
        } catch (err) {
            return { success: false, message: `Connection failed: ${err.message}` };
        }
    }

    async fetch(config: Record<string, any>, credentials?: Record<string, any>): Promise<DataSourceProviderResult> {
        if (!credentials?.apiKey) {
            throw new Error('FRED API Key is required');
        }

        const params: Record<string, any> = {
            series_id: config.seriesId,
            api_key: credentials.apiKey,
            file_type: 'json',
        };

        if (config.observationStart) params.observation_start = config.observationStart;
        if (config.observationEnd) params.observation_end = config.observationEnd;
        if (config.frequency) params.frequency = config.frequency;
        if (config.units) params.units = config.units;

        const response = await firstValueFrom(
            this.httpService.get('https://api.stlouisfed.org/fred/series/observations', {
                params,
                timeout: 30000,
            }),
        );

        const observations = response.data?.observations || [];
        const records = observations
            .filter((obs: any) => obs.value !== '.')
            .map((obs: any) => ({
                date: obs.date,
                value: parseFloat(obs.value),
            }));

        return {
            records,
            schema: [
                { key: 'date', name: 'Date', type: 'date', required: false },
                { key: 'value', name: 'Value', type: 'number', required: false },
            ],
        };
    }
}
