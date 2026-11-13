import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, IS_PUBLIC, SESSION_COOKIE, type AuthedRequest } from './auth-context';
import { SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Global guard: every route requires a live session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token)
      throw new UnauthorizedException({ error: 'UNAUTHENTICATED', message: 'Sign in required.' });

    const header = req.headers[CSRF_HEADER];
    const result = await this.sessions.resolve(
      token,
      typeof header === 'string' ? header : undefined,
      !SAFE_METHODS.has(req.method),
    );
    if ('error' in result) {
      if (result.error === 'CSRF')
        throw new ForbiddenException({
          error: 'CSRF_TOKEN_INVALID',
          message: 'Missing or invalid CSRF token.',
        });
      throw new UnauthorizedException({
        error: 'SESSION_INVALID',
        message: 'Session expired or invalid. Sign in again.',
      });
    }
    req.auth = result.auth;
    return true;
  }
}
