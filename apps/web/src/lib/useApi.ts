import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText } from './http';

/** GET loader with access-denied detection and an explicit reload after writes. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    setError(null);
    setDenied(false);
    api<T>(path)
      .then((d) => live && setData(d))
      .catch((e) => {
        if (!live) return;
        setData(null);
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setDenied(true);
        else setError(errorText(e));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, denied, loading, reload };
}
