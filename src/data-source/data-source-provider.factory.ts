import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { DataSourceProvider } from './data-source-provider.interface';

export const DATA_SOURCE_PROVIDERS = 'DATA_SOURCE_PROVIDERS';

@Injectable()
export class DataSourceProviderFactory implements OnModuleInit {
    private readonly logger = new Logger(DataSourceProviderFactory.name);
    private readonly providerMap = new Map<string, DataSourceProvider>();

    constructor(
        @Inject(DATA_SOURCE_PROVIDERS)
        private readonly injectedProviders: DataSourceProvider[],
    ) {}

    onModuleInit() {
        for (const provider of this.injectedProviders) {
            if (provider && typeof provider.fetch === 'function' && provider.type) {
                this.providerMap.set(provider.type, provider);
                this.logger.log(`Registered data source provider: ${provider.type} (${provider.displayName})`);
            }
        }
        this.logger.log(`Total registered data source providers: ${this.providerMap.size}`);
    }

    getProvider(type: string): DataSourceProvider | undefined {
        return this.providerMap.get(type);
    }

    getAllProviders(): {
        type: string;
        displayName: string;
        description: string;
        category: string;
        configSchema: Record<string, any>;
        credentialsSchema: Record<string, any> | null;
        defaultIncrementalKey: string | null;
    }[] {
        return Array.from(this.providerMap.values()).map(p => ({
            type: p.type,
            displayName: p.displayName,
            description: p.description,
            category: p.category,
            configSchema: p.configSchema,
            credentialsSchema: p.credentialsSchema,
            defaultIncrementalKey: p.defaultIncrementalKey,
        }));
    }
}
