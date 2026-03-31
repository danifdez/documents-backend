import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule.register());
  const configService = app.get(ConfigService);

  // Security: warn if auth is disabled
  const authEnabled = configService.get('AUTH_ENABLED') === 'true';
  if (!authEnabled) {
    logger.warn(
      'Authentication is DISABLED. All endpoints are publicly accessible. ' +
      'Set AUTH_ENABLED=true for production deployments.',
    );
  }

  // Security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin: configService.get('CORS_ORIGIN', 'http://localhost:5173'),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  const bodyLimit = configService.get('BODY_LIMIT', '50mb');
  app.use(bodyParser.json({ limit: bodyLimit }));
  app.use(bodyParser.urlencoded({ limit: bodyLimit, extended: true }));

  await app.listen(configService.get('PORT', 3000));
}
bootstrap();
