export type CheckStatus = 'up' | 'down';

export interface LivenessResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
  checks: {
    database: { status: CheckStatus; postgisVersion?: string; error?: string };
    migrations: { status: CheckStatus; applied?: number; pending?: number; error?: string };
  };
}
