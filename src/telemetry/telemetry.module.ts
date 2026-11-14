import {
  Logger,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationShutdown,
  OnModuleInit,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  configureTelemetry,
  shutdownTelemetry,
  traceRequest,
} from './telemetry';

@Module({ imports: [ConfigModule] })
export class TelemetryModule
  implements NestModule, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TelemetryModule.name);

  onModuleInit(): void {
    try {
      configureTelemetry();
    } catch {
      this.logger.warn('OpenTelemetry could not be initialized');
    }
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(traceRequest)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await shutdownTelemetry();
    } catch {
      this.logger.warn('OpenTelemetry shutdown failed');
    }
  }
}
