import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox } from '../components/ui';
import { errorText } from '../lib/http';

export function AccessDeniedPage() {
  return (
    <Card title="Access denied">
      <p className="text-sm">
        Your roles do not include permission for this page or record, or it is outside your assigned
        jurisdiction.
      </p>
      <p className="mt-3 text-sm">
        <Link className="text-blue-700 underline" to="/">
          Return home
        </Link>
      </p>
    </Card>
  );
}

export function ProfilePage() {
  const { me, logoutAll } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  return (
    <>
      <Card title="My profile">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
          <dt className="text-slate-500">Name</dt>
          <dd>{me.user.name}</dd>
          <dt className="text-slate-500">Email</dt>
          <dd>{me.user.email}</dd>
          <dt className="text-slate-500">Tenant</dt>
          <dd>
            {me.tenant.name} ({me.tenant.code})
          </dd>
        </dl>
      </Card>
      <Card title="Role assignments">
        <ul className="list-disc pl-5 text-sm">
          {me.roles.map((r) => (
            <li key={`${r.roleCode}-${r.scopeId}`}>
              {r.roleCode} — {r.scopeType}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Effective permissions: {me.permissions.join(', ') || 'none'}
        </p>
      </Card>
      <Card title="Sessions">
        <p className="mb-2 text-sm">Sign out of every browser and device using this account.</p>
        <ErrorBox error={error} />
        <Button
          variant="danger"
          onClick={() =>
            void logoutAll()
              .then(() => nav('/login', { replace: true }))
              .catch((e) => setError(errorText(e)))
          }
        >
          Sign out everywhere
        </Button>
      </Card>
    </>
  );
}
