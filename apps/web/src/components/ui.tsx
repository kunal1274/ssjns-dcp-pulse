import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { SYNTHETIC_DATA_DISCLAIMER } from '@dcp/shared';

export const Disclaimer = () => (
  <div
    role="note"
    className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
  >
    {SYNTHETIC_DATA_DISCLAIMER}
  </div>
);

export const Card = ({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) => (
  <section className="mb-6 rounded border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {actions}
    </div>
    {children}
  </section>
);

export const Button = ({
  variant = 'primary',
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) => (
  <button
    {...p}
    className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
      variant === 'primary'
        ? 'bg-blue-700 text-white hover:bg-blue-800'
        : variant === 'danger'
          ? 'bg-red-700 text-white hover:bg-red-800'
          : 'border border-slate-300 bg-white hover:bg-slate-50'
    } ${className}`}
  />
);

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="font-medium text-slate-700">{label}</span>
    {children}
  </label>
);

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={`rounded border border-slate-300 px-2 py-1.5 ${p.className ?? ''}`} />
);

export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...p}
    className={`rounded border border-slate-300 bg-white px-2 py-1.5 ${p.className ?? ''}`}
  />
);

export const ErrorBox = ({ error }: { error: string | null }) =>
  error ? (
    <p
      role="alert"
      className="my-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"
    >
      {error}
    </p>
  ) : null;

export const StatusPill = ({ status }: { status: string }) => {
  const c: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    SUBMITTED: 'bg-blue-100 text-blue-800',
    APPROVED: 'bg-green-100 text-green-800',
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    REJECTED: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-red-100 text-red-800',
    PENDING: 'bg-blue-100 text-blue-800',
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${c[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status}
    </span>
  );
};

export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
        <tr>
          {head.map((h) => (
            <th key={h} className="px-2 py-2">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>
);
