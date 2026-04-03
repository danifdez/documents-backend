import { DatasetField } from '../dataset/dataset.entity';

export interface DataSourceProviderResult {
    records: Record<string, any>[];
    schema?: DatasetField[];
    hasMore?: boolean;
    cursor?: string;
}

export interface DataSourceProvider {
    readonly type: string;
    readonly displayName: string;
    readonly description: string;
    readonly category: string;
    readonly configSchema: Record<string, any>;
    readonly credentialsSchema: Record<string, any> | null;
    /** Default field key for incremental sync (e.g. 'date', 'year'). Null for generic providers. */
    readonly defaultIncrementalKey: string | null;

    fetch(config: Record<string, any>, credentials?: Record<string, any>, cursor?: string): Promise<DataSourceProviderResult>;
    validateConfig(config: Record<string, any>): string[];
    testConnection(config: Record<string, any>, credentials?: Record<string, any>): Promise<{ success: boolean; message: string; sampleData?: any[] }>;
}
