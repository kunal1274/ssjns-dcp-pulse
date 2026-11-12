import type { LivenessResponse, ReadinessResponse } from '@dcp/shared';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Readiness returns 503 with a JSON body when a dependency is down; both are valid results. */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  const res = await fetch(`${BASE}/health/ready`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (res.status !== 200 && res.status !== 503) throw new Error(`Unexpected status ${res.status}`);
  return (await res.json()) as ReadinessResponse;
}

export async function fetchLiveness(signal?: AbortSignal): Promise<LivenessResponse> {
  const res = await fetch(`${BASE}/health/live`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
  return (await res.json()) as LivenessResponse;
}
