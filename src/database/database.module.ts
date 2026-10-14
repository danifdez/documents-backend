import { Module } from '@nestjs/common';
import { databaseProviders } from './database.providers';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmConfig } from './typeorm.config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DATABASE_ENTITIES } from './database-entities';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getTypeOrmConfig(configService),
    }),
    TypeOrmModule.forFeature([...DATABASE_ENTITIES]),
  ],
  providers: [...databaseProviders],
  exports: [...databaseProviders, TypeOrmModule],
})
export class DatabaseModule {}
