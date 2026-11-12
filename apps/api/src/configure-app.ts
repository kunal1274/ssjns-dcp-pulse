import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import type { AppEnv } from './config/env';

export const API_PREFIX = 'api/v1';

/** Shared HTTP configuration for the server and e2e tests. */
export function configureApp(app: INestApplication, env: AppEnv): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  if (env.corsOrigins.length > 0) app.enableCors({ origin: env.corsOrigins });

  const doc = new DocumentBuilder()
    .setTitle('DCP Pulse API')
    .setDescription('Synthetic demonstration only. F01–F03 foundation: health endpoints.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
