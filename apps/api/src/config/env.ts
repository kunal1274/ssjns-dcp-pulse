export interface AppEnv {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  logLevel: string;
  corsOrigins: string[];
  serviceName: string;
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

  if (errors.length > 0) throw new Error(`Invalid environment: ${errors.join('; ')}`);

  return {
    nodeEnv: source.NODE_ENV ?? 'development',
    port,
    databaseUrl,
    logLevel,
    corsOrigins: (source.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    serviceName: 'dcp-pulse-api',
  };
}
