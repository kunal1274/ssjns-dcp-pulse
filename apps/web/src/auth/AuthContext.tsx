import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, SESSION_EXPIRED_EVENT } from '../lib/http';
import type { Me } from '../lib/types';

type Status = 'loading' | 'anonymous' | 'authenticated' | 'expired';

interface AuthValue {
  status: Status;
  me: Me | null;
  can: (...permissions: string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<number>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
      setStatus('authenticated');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setStatus('anonymous');
      } else throw e;
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => setStatus('anonymous'));
    const onExpired = () => {
      setMe(null);
      setStatus('expired');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      can: (...p) => !!me && p.some((x) => me.permissions.includes(x)),
      login: async (email, password) => {
        await api('/auth/login', { method: 'POST', body: { email, password } });
        await refresh();
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        setMe(null);
        setStatus('anonymous');
      },
      logoutAll: async () => {
        const r = await api<{ revoked: number }>('/auth/logout-all', { method: 'POST' });
        setMe(null);
        setStatus('anonymous');
        return r.revoked;
      },
      refresh,
    }),
    [status, me, refresh],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
