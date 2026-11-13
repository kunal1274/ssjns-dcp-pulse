import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Disclaimer } from './ui';

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 text-sm ${isActive ? 'bg-blue-100 text-blue-900' : 'text-slate-700 hover:bg-slate-100'}`;

export function Layout() {
  const { me, can, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 p-3">
          <span className="mr-4 font-semibold">DCP Pulse</span>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {can('scheme.view') && (
              <NavLink to="/schemes" className={link}>
                Schemes
              </NavLink>
            )}
            {can('scheme.view', 'budget.allocate') && (
              <NavLink to="/budget" className={link}>
                Budget
              </NavLink>
            )}
            {can('user.manage') && (
              <NavLink to="/admin/users" className={link}>
                Users
              </NavLink>
            )}
            {can('role.manage') && (
              <NavLink to="/admin/roles" className={link}>
                Roles
              </NavLink>
            )}
            <NavLink to="/status" className={link}>
              Status
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <NavLink to="/profile" className={link}>
              {me?.user.name}
            </NavLink>
            <Button
              variant="secondary"
              onClick={() => void logout().then(() => nav('/login', { replace: true }))}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <Disclaimer />
        <Outlet />
      </main>
    </div>
  );
}

export function HomePage() {
  const { me } = useAuth();
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h1 className="text-xl font-semibold">Welcome, {me?.user.name}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Implemented so far: sign-in and sessions, role-based access administration, the scheme
        register and budget planning. Dashboards, releases, expenditure and progress are not
        implemented yet.
      </p>
    </section>
  );
}
