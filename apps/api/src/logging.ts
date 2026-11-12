import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppEnv } from './config/env';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Accept a safe inbound X-Request-Id for correlation, otherwise generate one. */
export function requestIdFor(req: IncomingMessage, res: ServerResponse): string {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && REQUEST_ID_RE.test(inbound) ? inbound : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

export function loggerParams(env: AppEnv): Params {
  return {
    pinoHttp: {
      level: env.logLevel,
      base: { service: env.serviceName },
      genReqId: requestIdFor,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url?.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customProps: (req) => ({ requestId: (req as IncomingMessage & { id?: string }).id }),
    },
  };
}
