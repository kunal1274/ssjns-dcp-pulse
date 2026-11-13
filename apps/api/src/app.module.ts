import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './config/env';
import { FinanceModule } from './finance/finance.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { SchemesModule } from './schemes/schemes.module';
import { HealthModule } from './health/health.module';
import { loggerParams } from './logging';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams(loadEnv())),
    PrismaModule,
    AuthModule,
    AdminModule,
    SchemesModule,
    FinanceModule,
    HealthModule,
  ],
})
export class AppModule {}
