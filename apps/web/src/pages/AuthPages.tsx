import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, Disclaimer, ErrorBox, Field, Input } from '../components/ui';
import { api, errorText } from '../lib/http';

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto mt-10 max-w-md space-y-4 p-4">
    <Disclaimer />
    <h1 className="text-2xl font-semibold">DCP Pulse</h1>
    {children}
  </main>
);

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      const next = params.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Card title="Sign in">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-3 text-sm">
          <Link className="text-blue-700 underline" to="/forgot-password">
            Forgot password?
          </Link>
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Accounts are created by administrator invitation only.
        </p>
      </Card>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setDone(r.message);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Shell>
      <Card title="Reset password">
        {done ? (
          <p role="status">{done}</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <ErrorBox error={error} />
            <Button type="submit">Send reset link</Button>
          </form>
        )}
        <p className="mt-3 text-sm">
          <Link className="text-blue-700 underline" to="/login">
            Back to sign in
          </Link>
        </p>
      </Card>
    </Shell>
  );
}

/** Shared by password reset and invitation acceptance: both consume a single-use token. */
export function SetPasswordPage({ mode }: { mode: 'reset' | 'invite' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError('Passwords do not match.');
    try {
      await api(mode === 'reset' ? '/auth/reset-password' : '/auth/accept-invite', {
        method: 'POST',
        body: { token, newPassword: pw },
      });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Shell>
      <Card title={mode === 'reset' ? 'Choose a new password' : 'Accept invitation'}>
        {done ? (
          <p role="status">
            Password set.{' '}
            <Link className="text-blue-700 underline" to="/login">
              Sign in
            </Link>
          </p>
        ) : !token ? (
          <ErrorBox error="This link is missing its token." />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="New password (min. 12 characters)">
              <Input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </Field>
            <Field label="Confirm password">
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </Field>
            <ErrorBox error={error} />
            <Button type="submit">Set password</Button>
          </form>
        )}
      </Card>
    </Shell>
  );
}

export function SessionExpiredPage() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  return (
    <Shell>
      <Card title="Session expired">
        <p className="mb-3 text-sm">Your session has ended or was revoked. Please sign in again.</p>
        <Button onClick={() => void refresh().finally(() => nav('/login', { replace: true }))}>
          Sign in
        </Button>
      </Card>
    </Shell>
  );
}
