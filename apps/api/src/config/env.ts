export interface AppEnv {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  logLevel: string;
  corsOrigins: string[];
  serviceName: string;
  auth: AuthEnv;
}

export interface AuthEnv {
  defaultTenantCode: string;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  cookieSecure: boolean;
  resetTokenMinutes: number;
  inviteTokenHours: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
  appBaseUrl: string;
  mailTransport: 'file' | 'none';
  mailOutboxDir: string;
  rateLimitPerMinute: number;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const errors: string[] = [];

  const databaseUrl = source.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    errors.push('DATABASE_URL must be a postgresql:// URL');

  const port = Number(source.API_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.push('API_PORT must be a valid port');

  const logLevel = source.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel))
    errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  const int = (name: string, fallback: number, min: number, max: number): number => {
    const value = Number(source[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      errors.push(`${name} must be an integer between ${min} and ${max}`);
    return value;
  };
  const nodeEnv = source.NODE_ENV ?? 'development';
  const mailTransport = (source.MAIL_TRANSPORT ?? 'file') as AuthEnv['mailTransport'];
  if (!['file', 'none'].includes(mailTransport)) errors.push('MAIL_TRANSPORT must be file or none');
  const auth: AuthEnv = {
    defaultTenantCode: source.DEFAULT_TENANT_CODE ?? 'ASSAM-DEMO',
    sessionIdleMinutes: int('SESSION_IDLE_MINUTES', 30, 1, 1440),
    sessionAbsoluteHours: int('SESSION_ABSOLUTE_HOURS', 12, 1, 168),
    cookieSecure:
      (source.COOKIE_SECURE ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    resetTokenMinutes: int('RESET_TOKEN_MINUTES', 30, 5, 1440),
    inviteTokenHours: int('INVITE_TOKEN_HOURS', 72, 1, 720),
    maxFailedLogins: int('MAX_FAILED_LOGINS', 5, 1, 100),
    lockoutMinutes: int('LOCKOUT_MINUTES', 15, 1, 1440),
    appBaseUrl: source.APP_BASE_URL ?? 'http://localhost:5173',
    mailTransport,
    mailOutboxDir: source.MAIL_OUTBOX_DIR ?? 'var/mail-outbox',
    rateLimitPerMinute: int('AUTH_RATE_LIMIT_PER_MINUTE', 10, 1, 10000),
  };

  if (errors.length > 0) throw new Error(`Invalid environment: ${errors.join('; ')}`);

  return {
    nodeEnv,
    port,
    databaseUrl,
    logLevel,
    corsOrigins: (source.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    serviceName: 'dcp-pulse-api',
    auth,
  };
}

export const APP_ENV = Symbol('APP_ENV');
