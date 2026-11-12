export interface PermissionDefinition {
  code: string;
  resource: string;
  action: string;
  description: string;
}

const p = (code: string, description: string): PermissionDefinition => {
  const lastDot = code.lastIndexOf('.');
  return { code, resource: code.slice(0, lastDot), action: code.slice(lastDot + 1), description };
};

/** Permission catalogue from specification §7. */
export const PERMISSIONS: readonly PermissionDefinition[] = [
  p('scheme.view', 'View schemes within authorised scope'),
  p('scheme.create', 'Create scheme drafts'),
  p('scheme.edit', 'Edit scheme drafts'),
  p('scheme.submit', 'Submit schemes for approval'),
  p('scheme.approve', 'Approve schemes'),
  p('budget.request.create', 'Create and submit bottom-up budget requests'),
  p('budget.request.review', 'Review budget requests'),
  p('budget.allocate', 'Allocate approved budget'),
  p('budget.revise', 'Revise approved budget with reason'),
  p('release.record', 'Record fund releases'),
  p('expenditure.submit', 'Submit expenditure records'),
  p('expenditure.verify', 'Verify expenditure records'),
  p('progress.submit', 'Submit physical progress'),
  p('progress.verify', 'Verify or return physical progress'),
  p('alert.view', 'View alerts'),
  p('alert.assign', 'Assign alerts and corrective actions'),
  p('alert.resolve', 'Resolve alerts'),
  p('report.view', 'View dashboards and reports'),
  p('report.export', 'Export reports'),
  p('audit.view', 'View business audit events'),
  p('role.manage', 'Manage roles'),
  p('user.manage', 'Manage users'),
  p('integration.manage', 'Manage imports and integrations'),
];

export interface RoleTemplate {
  code: string;
  name: string;
  permissions: readonly string[];
}

/**
 * Illustrative initial role templates (§7). These are demo templates, not an
 * official approval structure. System Administrator intentionally has no
 * budget-approval or verification permission.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: 'STATE_MONITOR',
    name: 'State Monitor',
    permissions: ['scheme.view', 'alert.view', 'report.view', 'report.export', 'audit.view'],
  },
  {
    code: 'STATE_PLANNER',
    name: 'State Planner',
    permissions: [
      'scheme.view',
      'scheme.create',
      'scheme.edit',
      'scheme.submit',
      'scheme.approve',
      'budget.request.review',
      'budget.allocate',
      'budget.revise',
      'report.view',
    ],
  },
  {
    code: 'DISTRICT_REVIEWER',
    name: 'District Reviewer',
    permissions: [
      'scheme.view',
      'budget.request.create',
      'budget.request.review',
      'progress.verify',
      'alert.view',
      'alert.assign',
      'alert.resolve',
      'report.view',
    ],
  },
  {
    code: 'CO_DISTRICT_REVIEWER',
    name: 'Co-district Reviewer',
    permissions: [
      'scheme.view',
      'budget.request.create',
      'progress.verify',
      'alert.view',
      'report.view',
    ],
  },
  {
    code: 'IMPLEMENTING_OFFICER',
    name: 'Implementing Officer',
    permissions: [
      'scheme.view',
      'budget.request.create',
      'progress.submit',
      'expenditure.submit',
      'alert.view',
    ],
  },
  {
    code: 'FINANCE_REVIEWER',
    name: 'Finance Reviewer',
    permissions: [
      'scheme.view',
      'release.record',
      'expenditure.verify',
      'alert.view',
      'report.view',
    ],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    permissions: ['scheme.view', 'alert.view', 'report.view', 'report.export', 'audit.view'],
  },
  {
    code: 'SYSTEM_ADMIN',
    name: 'System Administrator',
    permissions: ['role.manage', 'user.manage', 'integration.manage', 'audit.view'],
  },
];
