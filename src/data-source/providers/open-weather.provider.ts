import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DataSourceProvider, DataSourceProviderResult } from '../data-source-provider.interface';

@Injectable()
export class OpenWeatherProvider implements DataSourceProvider {
    readonly type = 'open_weather';
    readonly displayName = 'OpenWeatherMap';
    readonly description = 'Current weather and 5-day forecast for any location';
    readonly category = 'weather';
    readonly defaultIncrementalKey = 'datetime';

    readonly configSchema = {
        type: 'object',
        properties: {
            lat: { type: 'number', title: 'Latitude', description: 'e.g. 40.4168 (Madrid)' },
            lon: { type: 'number', title: 'Longitude', description: 'e.g. -3.7038 (Madrid)' },
            dataType: { type: 'string', title: 'Data type', enum: ['current', 'forecast'], default: 'current' },
            units: { type: 'string', title: 'Units', enum: ['metric', 'imperial', 'standard'], default: 'metric' },
            lang: { type: 'string', title: 'Language', default: 'en', description: 'ISO code (en, es, fr, de...)' },
        },
        required: ['lat', 'lon'],
    };

    readonly credentialsSchema = {
        type: 'object',
        properties: {
            apiKey: { type: 'string', title: 'API Key', description: 'Get free at openweathermap.org/api' },
        },
        required: ['apiKey'],
    };

    constructor(private readonly httpService: HttpService) {}

    validateConfig(config: Record<string, any>): string[] {
        const errors: string[] = [];
        if (config.lat === undefined || config.lat === null) errors.push('Latitude is required');
        if (config.lon === undefined || config.lon === null) errors.push('Longitude is required');
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
                message: `Successfully fetched ${result.records.length} weather records`,
                sampleData: result.records.slice(0, 5),
            };
        } catch (err) {
            return { success: false, message: `Connection failed: ${err.message}` };
        }
    }

    async fetch(config: Record<string, any>, credentials?: Record<string, any>): Promise<DataSourceProviderResult> {
        if (!credentials?.apiKey) {
            throw new Error('OpenWeatherMap API Key is required');
        }

        if (config.dataType === 'forecast') {
            return this.fetchForecast(config, credentials);
        }
        return this.fetchCurrent(config, credentials);
    }

    private async fetchCurrent(config: Record<string, any>, credentials: Record<string, any>): Promise<DataSourceProviderResult> {
        const response = await firstValueFrom(
            this.httpService.get('https://api.openweathermap.org/data/2.5/weather', {
                params: {
                    lat: config.lat,
                    lon: config.lon,
                    appid: credentials.apiKey,
                    units: config.units || 'metric',
                    lang: config.lang || 'en',
                },
                timeout: 15000,
            }),
        );

        const d = response.data;
        const record = {
            datetime: new Date(d.dt * 1000).toISOString(),
            temp: d.main?.temp,
            feels_like: d.main?.feels_like,
            humidity: d.main?.humidity,
            pressure: d.main?.pressure,
            wind_speed: d.wind?.speed,
            wind_deg: d.wind?.deg,
            description: d.weather?.[0]?.description,
            clouds: d.clouds?.all,
            visibility: d.visibility,
            location: d.name,
        };

        return {
            records: [record],
            schema: this.getSchema(),
        };
    }

    private async fetchForecast(config: Record<string, any>, credentials: Record<string, any>): Promise<DataSourceProviderResult> {
        const response = await firstValueFrom(
            this.httpService.get('https://api.openweathermap.org/data/2.5/forecast', {
                params: {
                    lat: config.lat,
                    lon: config.lon,
                    appid: credentials.apiKey,
                    units: config.units || 'metric',
                    lang: config.lang || 'en',
                },
                timeout: 15000,
            }),
        );

        const list = response.data?.list || [];
        const cityName = response.data?.city?.name || '';

        const records = list.map((item: any) => ({
            datetime: item.dt_txt || new Date(item.dt * 1000).toISOString(),
            temp: item.main?.temp,
            feels_like: item.main?.feels_like,
            humidity: item.main?.humidity,
            pressure: item.main?.pressure,
            wind_speed: item.wind?.speed,
            wind_deg: item.wind?.deg,
            description: item.weather?.[0]?.description,
            clouds: item.clouds?.all,
            visibility: item.visibility,
            location: cityName,
        }));

        return {
            records,
            schema: this.getSchema(),
        };
    }

    private getSchema() {
        return [
            { key: 'datetime', name: 'Date/Time', type: 'datetime' as const, required: false },
            { key: 'temp', name: 'Temperature', type: 'number' as const, required: false },
            { key: 'feels_like', name: 'Feels Like', type: 'number' as const, required: false },
            { key: 'humidity', name: 'Humidity (%)', type: 'number' as const, required: false },
            { key: 'pressure', name: 'Pressure (hPa)', type: 'number' as const, required: false },
            { key: 'wind_speed', name: 'Wind Speed', type: 'number' as const, required: false },
            { key: 'wind_deg', name: 'Wind Direction', type: 'number' as const, required: false },
            { key: 'description', name: 'Description', type: 'text' as const, required: false },
            { key: 'clouds', name: 'Clouds (%)', type: 'number' as const, required: false },
            { key: 'visibility', name: 'Visibility (m)', type: 'number' as const, required: false },
            { key: 'location', name: 'Location', type: 'text' as const, required: false },
        ];
    }
}
