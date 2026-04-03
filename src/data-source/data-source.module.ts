import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '../database/database.module';
import { DatasetModule } from '../dataset/dataset.module';
import { DataSourceController } from './data-source.controller';
import { DataSourceService } from './data-source.service';
import { DataSourceSyncService } from './data-source-sync.service';
import { DataSourceScheduleService } from './data-source-schedule.service';
import { DataSourceProviderFactory, DATA_SOURCE_PROVIDERS } from './data-source-provider.factory';
import { DataSourceEncryptionService } from './data-source-encryption.service';

// Import all providers
import { CsvUrlProvider } from './providers/csv-url.provider';
import { RestApiProvider } from './providers/rest-api.provider';
import { WorldBankProvider } from './providers/world-bank.provider';
import { FredProvider } from './providers/fred.provider';
import { EurostatProvider } from './providers/eurostat.provider';
import { YahooFinanceProvider } from './providers/yahoo-finance.provider';
import { OpenWeatherProvider } from './providers/open-weather.provider';

const providerClasses = [
    CsvUrlProvider,
    RestApiProvider,
    WorldBankProvider,
    FredProvider,
    EurostatProvider,
    YahooFinanceProvider,
    OpenWeatherProvider,
];

@Module({
    imports: [DatabaseModule, HttpModule, DatasetModule],
    controllers: [DataSourceController],
    providers: [
        DataSourceService,
        DataSourceSyncService,
        DataSourceScheduleService,
        DataSourceProviderFactory,
        DataSourceEncryptionService,
        // Register each provider class in DI
        ...providerClasses,
        // Inject all providers as an array into the factory
        {
            provide: DATA_SOURCE_PROVIDERS,
            useFactory: (...providers: any[]) => providers,
            inject: providerClasses,
        },
    ],
    exports: [DataSourceService, DataSourceSyncService],
})
export class DataSourceModule {}
