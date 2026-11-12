import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthContext {
  tenantId: string;
  userId: string;
  sessionId: string;
  email: string;
  name: string;
}

export type AuthedRequest = Request & { auth?: AuthContext; id?: string };

export const IS_PUBLIC = 'dcp:isPublic';
/** Marks a route as reachable without a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('CurrentAuth used on a public route');
  return auth;
});

export const SESSION_COOKIE = 'dcp_session';
export const CSRF_COOKIE = 'dcp_csrf';
export const CSRF_HEADER = 'x-csrf-token';
