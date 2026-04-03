import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DataSourceProvider, DataSourceProviderResult } from '../data-source-provider.interface';

@Injectable()
export class YahooFinanceProvider implements DataSourceProvider {
    readonly type = 'yahoo_finance';
    readonly displayName = 'Yahoo Finance';
    readonly description = 'Stock quotes, historical prices, and company financials';
    readonly category = 'finance';
    readonly defaultIncrementalKey = 'date';

    readonly configSchema = {
        type: 'object',
        properties: {
            symbol: { type: 'string', title: 'Symbol', description: 'e.g. AAPL, MSFT, ^GSPC (S&P 500), EURUSD=X' },
            dataType: { type: 'string', title: 'Data type', enum: ['history', 'quote'], default: 'history' },
            interval: { type: 'string', title: 'Interval', enum: ['1d', '1wk', '1mo'], default: '1d', description: 'For historical data only' },
            range: { type: 'string', title: 'Range', enum: ['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'], default: '1y' },
        },
        required: ['symbol'],
    };

    readonly credentialsSchema = null;

    constructor(private readonly httpService: HttpService) {}

    validateConfig(config: Record<string, any>): string[] {
        const errors: string[] = [];
        if (!config.symbol) errors.push('Symbol is required');
        return errors;
    }

    async testConnection(config: Record<string, any>): Promise<{ success: boolean; message: string; sampleData?: any[] }> {
        try {
            const result = await this.fetch(config);
            return {
                success: true,
                message: `Fetched ${result.records.length} records for ${config.symbol}`,
                sampleData: result.records.slice(0, 5),
            };
        } catch (err) {
            return { success: false, message: `Connection failed: ${err.message}` };
        }
    }

    async fetch(config: Record<string, any>): Promise<DataSourceProviderResult> {
        if (config.dataType === 'quote') {
            return this.fetchQuote(config);
        }
        return this.fetchHistory(config);
    }

    private async fetchHistory(config: Record<string, any>): Promise<DataSourceProviderResult> {
        const symbol = encodeURIComponent(config.symbol);
        const interval = config.interval || '1d';
        const range = config.range || '1y';

        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}`;
        const response = await firstValueFrom(
            this.httpService.get(url, {
                params: { interval, range },
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 30000,
            }),
        );

        const result = response.data?.chart?.result?.[0];
        if (!result) {
            throw new Error(`No data found for symbol ${config.symbol}`);
        }

        const timestamps = result.timestamp || [];
        const quote = result.indicators?.quote?.[0] || {};

        const records = timestamps.map((ts: number, i: number) => ({
            date: new Date(ts * 1000).toISOString().split('T')[0],
            open: quote.open?.[i] != null ? Number(quote.open[i].toFixed(4)) : null,
            high: quote.high?.[i] != null ? Number(quote.high[i].toFixed(4)) : null,
            low: quote.low?.[i] != null ? Number(quote.low[i].toFixed(4)) : null,
            close: quote.close?.[i] != null ? Number(quote.close[i].toFixed(4)) : null,
            volume: quote.volume?.[i] ?? null,
        }));

        return {
            records,
            schema: [
                { key: 'date', name: 'Date', type: 'date', required: false },
                { key: 'open', name: 'Open', type: 'number', required: false },
                { key: 'high', name: 'High', type: 'number', required: false },
                { key: 'low', name: 'Low', type: 'number', required: false },
                { key: 'close', name: 'Close', type: 'number', required: false },
                { key: 'volume', name: 'Volume', type: 'number', required: false },
            ],
        };
    }

    private async fetchQuote(config: Record<string, any>): Promise<DataSourceProviderResult> {
        const symbol = encodeURIComponent(config.symbol);
        const url = `https://query2.finance.yahoo.com/v7/finance/quote`;
        const response = await firstValueFrom(
            this.httpService.get(url, {
                params: { symbols: symbol },
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 30000,
            }),
        );

        const quotes = response.data?.quoteResponse?.result || [];
        const records = quotes.map((q: any) => ({
            symbol: q.symbol,
            name: q.shortName || q.longName,
            price: q.regularMarketPrice,
            change: q.regularMarketChange,
            change_percent: q.regularMarketChangePercent,
            market_cap: q.marketCap,
            volume: q.regularMarketVolume,
            currency: q.currency,
        }));

        return {
            records,
            schema: [
                { key: 'symbol', name: 'Symbol', type: 'text', required: false },
                { key: 'name', name: 'Name', type: 'text', required: false },
                { key: 'price', name: 'Price', type: 'number', required: false },
                { key: 'change', name: 'Change', type: 'number', required: false },
                { key: 'change_percent', name: 'Change %', type: 'number', required: false },
                { key: 'market_cap', name: 'Market Cap', type: 'number', required: false },
                { key: 'volume', name: 'Volume', type: 'number', required: false },
                { key: 'currency', name: 'Currency', type: 'text', required: false },
            ],
        };
    }
}
