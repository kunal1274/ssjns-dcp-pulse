import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Input, Select, StatusPill, Table } from '../components/ui';
import { api, errorText } from '../lib/http';
import type { Jurisdiction, Ref } from '../lib/types';

interface RoleScope {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  scopeType: string;
  scopeId: string;
  includeDescendants: boolean;
}
interface AdminUser {
  id: string;
  email: string;
  name: string;
  status: string;
  version: number;
  roleScopes: RoleScope[];
}
interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystemTemplate: boolean;
  status: string;
  version: number;
  permissions: string[];
  assignmentCount?: number;
}
interface Permission {
  id: string;
  code: string;
  description: string | null;
}

export function UsersPage() {
  const { me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [agencies, setAgencies] = useState<Ref[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminUser[]>('/users')
      .then(setUsers)
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    load();
    void api<Role[]>('/roles')
      .then(setRoles)
      .catch(() => undefined);
    void api<Jurisdiction[]>('/jurisdictions')
      .then(setJurisdictions)
      .catch(() => undefined);
    void api<Ref[]>('/agencies')
      .then(setAgencies)
      .catch(() => undefined);
  }, [load]);

  const scopeName = (s: RoleScope) =>
    s.scopeType === 'TENANT'
      ? 'Whole tenant'
      : s.scopeType === 'JURISDICTION'
        ? `${jurisdictions.find((j) => j.id === s.scopeId)?.name ?? s.scopeId}${s.includeDescendants ? ' + children' : ' only'}`
        : s.scopeType === 'AGENCY'
          ? (agencies.find((a) => a.id === s.scopeId)?.name ?? s.scopeId)
          : `Scheme ${s.scopeId.slice(0, 8)}`;

  const call = (p: Promise<unknown>) => {
    setError(null);
    p.then(load).catch((e) => setError(errorText(e)));
  };

  const invite = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const form = e.currentTarget;
    api<{ email: string }>('/users/invite', { method: 'POST', body: f })
      .then((u) => {
        setNotice(`Invitation sent to ${u.email}. The single-use link is delivered by email only.`);
        form.reset();
        load();
      })
      .catch((err) => setError(errorText(err)));
  };

  return (
    <>
      <Card title="Users">
        <ErrorBox error={error} />
        {notice && (
          <p role="status" className="mb-2 text-sm text-green-800">
            {notice}
          </p>
        )}
        <Table head={['User', 'Status', 'Role assignments', 'Actions']}>
          {users.map((u) => (
            <tr key={u.id} data-testid={`user-${u.email}`}>
              <td className="px-2 py-1.5">
                <div>{u.name}</div>
                <div className="text-xs text-slate-500">{u.email}</div>
              </td>
              <td className="px-2 py-1.5">
                <StatusPill status={u.status} />
              </td>
              <td className="px-2 py-1.5">
                <ul className="space-y-1">
                  {u.roleScopes.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono">{s.roleCode}</span> — {scopeName(s)}
                      {u.id !== me?.user.id && (
                        <button
                          className="text-red-700 underline"
                          onClick={() => {
                            const reason = window.prompt(
                              `Revoke ${s.roleCode} from ${u.email}? Reason:`,
                            );
                            if (reason)
                              call(
                                api(`/users/${u.id}/role-scopes/${s.id}`, {
                                  method: 'DELETE',
                                  body: { reason },
                                }),
                              );
                          }}
                        >
                          revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {u.id !== me?.user.id && (
                  <AssignForm
                    roles={roles}
                    jurisdictions={jurisdictions}
                    agencies={agencies}
                    onSubmit={(body) =>
                      call(api(`/users/${u.id}/role-scopes`, { method: 'POST', body }))
                    }
                  />
                )}
              </td>
              <td className="px-2 py-1.5 space-y-1">
                {u.id === me?.user.id ? (
                  <span className="text-xs text-slate-500">You cannot change your own access.</span>
                ) : (
                  ['ACTIVE', 'SUSPENDED', 'DISABLED']
                    .filter((s) => s !== u.status && !(u.status === 'INVITED' && s === 'ACTIVE'))
                    .map((s) => (
                      <Button
                        key={s}
                        variant={s === 'ACTIVE' ? 'secondary' : 'danger'}
                        className="block"
                        onClick={() =>
                          call(
                            api(`/users/${u.id}/status`, {
                              method: 'PATCH',
                              body: { status: s, reason: 'Changed by administrator' },
                            }),
                          )
                        }
                      >
                        {s === 'ACTIVE' ? 'Reactivate' : s === 'SUSPENDED' ? 'Suspend' : 'Disable'}
                      </Button>
                    ))
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Invite a user">
        <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
          <Field label="Name">
            <Input name="name" required />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" required />
          </Field>
          <Button type="submit">Send invitation</Button>
        </form>
      </Card>
    </>
  );
}

function AssignForm({
  roles,
  jurisdictions,
  agencies,
  onSubmit,
}: {
  roles: Role[];
  jurisdictions: Jurisdiction[];
  agencies: Ref[];
  onSubmit: (b: object) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState('JURISDICTION');
  if (!open)
    return (
      <button className="mt-1 text-xs text-blue-700 underline" onClick={() => setOpen(true)}>
        + assign role
      </button>
    );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSubmit({
      roleId: f.get('roleId'),
      scopeType,
      scopeId: scopeType === 'TENANT' ? undefined : f.get('scopeId'),
      includeDescendants:
        scopeType === 'JURISDICTION' ? f.get('includeDescendants') === 'on' : undefined,
    });
    setOpen(false);
  };
  return (
    <form
      onSubmit={submit}
      className="mt-2 flex flex-wrap items-end gap-1 rounded bg-slate-50 p-2 text-xs"
    >
      <Select name="roleId" aria-label="Role" required>
        {roles
          .filter((r) => r.status === 'ACTIVE')
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.code}
            </option>
          ))}
      </Select>
      <Select
        aria-label="Scope type"
        value={scopeType}
        onChange={(e) => setScopeType(e.target.value)}
      >
        <option>TENANT</option>
        <option>JURISDICTION</option>
        <option>AGENCY</option>
      </Select>
      {scopeType === 'JURISDICTION' && (
        <>
          <Select name="scopeId" aria-label="Jurisdiction">
            {jurisdictions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1">
            <input type="checkbox" name="includeDescendants" defaultChecked /> include children
          </label>
        </>
      )}
      {scopeType === 'AGENCY' && (
        <Select name="scopeId" aria-label="Agency">
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      )}
      <Button type="submit">Assign</Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        Close
      </Button>
    </form>
  );
}

export function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Role[]>('/roles')
      .then(setRoles)
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    load();
    void api<Permission[]>('/permissions')
      .then(setPerms)
      .catch(() => undefined);
  }, [load]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const permissions = f.getAll('permissions') as string[];
    const body = editing
      ? {
          version: editing.version,
          name: f.get('name'),
          description: f.get('description') || undefined,
          permissions,
        }
      : {
          code: f.get('code'),
          name: f.get('name'),
          description: f.get('description') || undefined,
          permissions,
        };
    setError(null);
    api(editing ? `/roles/${editing.id}` : '/roles', { method: editing ? 'PATCH' : 'POST', body })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err) => setError(errorText(err)));
  };

  return (
    <>
      <Card title="Roles">
        <Table head={['Code', 'Name', 'Type', 'Status', 'Assignments', 'Permissions', '']}>
          {roles.map((r) => (
            <tr key={r.id}>
              <td className="px-2 py-1.5 font-mono">{r.code}</td>
              <td className="px-2 py-1.5">{r.name}</td>
              <td className="px-2 py-1.5 text-xs">
                {r.isSystemTemplate ? 'Template (read-only)' : 'Custom'}
              </td>
              <td className="px-2 py-1.5">
                <StatusPill status={r.status} />
              </td>
              <td className="px-2 py-1.5">{r.assignmentCount ?? '—'}</td>
              <td className="px-2 py-1.5 text-xs">{r.permissions.join(', ')}</td>
              <td className="px-2 py-1.5">
                {!r.isSystemTemplate && (
                  <Button variant="secondary" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={editing ? `Edit ${editing.code}` : 'Create custom role'}>
        <form key={editing?.id ?? 'new'} onSubmit={submit} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <Field label="Code (UPPER_SNAKE)">
                <Input name="code" required pattern="^[A-Z][A-Z0-9_]{2,49}$" />
              </Field>
            )}
            <Field label="Name">
              <Input name="name" required defaultValue={editing?.name} />
            </Field>
            <Field label="Description">
              <Input name="description" defaultValue={editing?.description ?? ''} />
            </Field>
          </div>
          <fieldset className="grid grid-cols-2 gap-1 text-sm md:grid-cols-4">
            <legend className="mb-1 font-medium">Permissions</legend>
            {perms.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-1"
                title={p.description ?? undefined}
              >
                <input
                  type="checkbox"
                  name="permissions"
                  value={p.code}
                  defaultChecked={editing?.permissions.includes(p.code)}
                />
                <span className="font-mono text-xs">{p.code}</span>
              </label>
            ))}
          </fieldset>
          <ErrorBox error={error} />
          <div className="space-x-2">
            <Button type="submit">{editing ? 'Save changes' : 'Create role'}</Button>
            {editing && (
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}
