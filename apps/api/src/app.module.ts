import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { loggerParams } from './logging';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [LoggerModule.forRoot(loggerParams(loadEnv())), PrismaModule, HealthModule],
})
export class AppModule {}
