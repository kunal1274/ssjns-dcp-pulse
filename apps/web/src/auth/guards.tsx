import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <p className="p-6 text-slate-500">Loading…</p>;
  if (status === 'expired') return <Navigate to="/session-expired" replace />;
  if (status === 'anonymous')
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequirePermission({ any, children }: { any: string[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...any) ? <>{children}</> : <Navigate to="/access-denied" replace />;
}
