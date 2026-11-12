import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_ENV, loadEnv, type AppEnv } from '../config/env';
import { AuthorizationService } from '../authz/authorization.service';
import { FileMailSender, MailSender, NoopMailSender } from '../mail/mail.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionGuard } from './session.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { SessionService } from './session.service';

const env = loadEnv();

@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: env.auth.rateLimitPerMinute }]),
  ],
  controllers: [AuthController],
  providers: [
    { provide: APP_ENV, useValue: env },
    {
      provide: MailSender,
      inject: [APP_ENV],
      useFactory: (e: AppEnv) =>
        e.auth.mailTransport === 'file'
          ? new FileMailSender(e.auth.mailOutboxDir)
          : new NoopMailSender(),
    },
    PasswordService,
    SessionService,
    AuthService,
    AuthorizationService,
    // Order matters: authenticate first, then check route permissions.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [APP_ENV, AuthorizationService, SessionService, PasswordService, MailSender],
})
export class AuthModule {}
