import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import type { AppEnv } from './config/env';

export const API_PREFIX = 'api/v1';

/** Shared HTTP configuration for the server and e2e tests. */
export function configureApp(app: INestApplication, env: AppEnv): void {
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  // One reverse proxy (nginx) in front of the API; needed for per-client rate limits.
  (app as NestExpressApplication).set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  if (env.corsOrigins.length > 0) app.enableCors({ origin: env.corsOrigins, credentials: true });

  const doc = new DocumentBuilder()
    .setTitle('DCP Pulse API')
    .setDescription(
      'Synthetic demonstration only. Health, authentication, RBAC, scheme registry and budget APIs.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('dcp_session')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
