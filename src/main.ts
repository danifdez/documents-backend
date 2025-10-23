import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configure CORS for the frontend / Electron app
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Allow larger request bodies (useful when frontend sends large HTML/content)
  // Make this configurable via env var BODY_LIMIT (e.g. "10mb", "50mb").
  const bodyLimit = process.env.BODY_LIMIT ?? '50mb';
  app.use(bodyParser.json({ limit: bodyLimit }));
  app.use(bodyParser.urlencoded({ limit: bodyLimit, extended: true }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
