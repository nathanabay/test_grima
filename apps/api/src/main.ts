import 'reflect-metadata';
import { loadEnv } from './common/config/env';

// Before anything reads process.env: the repository keeps one .env at its root
// and each workspace package runs from its own directory (§65).
loadEnv(__dirname);

import { ValidationPipe, Logger, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // §54: security headers, CORS restricted to the configured web origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  /**
   * API versioning (§52: feature 981).
   *
   * Every route is registered twice: once unversioned and once under /api/v1.
   * A client that has been calling /api/... keeps working while new
   * integrations can pin /api/v1/..., which is the point of introducing a
   * version at all - breaking every existing caller on the day versioning
   * arrives is how integrations get abandoned rather than upgraded.
   *
   * A future v2 is added per controller with @Version('2'); v1 stays as it is
   * until it is deliberately retired.
   */
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [VERSION_NEUTRAL, '1'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('PharmaCore API')
    .setDescription(
      'Enterprise Pharmacy Inventory & Management System. ' +
        'All endpoints require a bearer token except those marked public.',
    )
    .setVersion('1.0')
    .addServer('/api', 'Unversioned (current)')
    .addServer('/api/v1', 'Version 1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`PharmaCore API listening on http://localhost:${port}/api`);
  logger.log(`OpenAPI documentation at http://localhost:${port}/api/docs`);
  logger.log(`Versioned base path: http://localhost:${port}/api/v1`);
}

void bootstrap();
