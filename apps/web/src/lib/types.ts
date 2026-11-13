export interface Me {
  user: { id: string; email: string; name: string };
  tenant: { id: string; code: string; name: string };
  roles: { roleCode: string; scopeType: string; scopeId: string }[];
  permissions: string[];
}
export interface Ref {
  id: string;
  code: string;
  name: string;
}
export interface Jurisdiction extends Ref {
  parentId: string | null;
  type: { code: string; displayName: string };
}
export interface Scheme {
  id: string;
  schemeCode: string;
  name: string;
  category: string;
  department: string | null;
  description: string | null;
  objectives: string | null;
  status: string;
  statusReason: string | null;
  startDate: string | null;
  targetEndDate: string | null;
  financialYear: { id: string; code: string };
  jurisdiction: Ref;
  agency: Ref;
  approvedBudget: string | null;
  proposedBudget: string | null;
  allocatedAmount: string;
  createdBy: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  version: number;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface FinancialYear {
  id: string;
  code: string;
  status: string;
}
export interface Ceiling {
  id: string;
  financialYearId: string;
  jurisdictionId: string;
  jurisdiction: { code: string; name: string } | null;
  status: string;
  totalAmount: string;
  allocatedApproved: string;
  allocatedPending: string;
  remaining: string;
  available: string;
  createdBy: string | null;
  version: number;
}
export interface Allocation {
  id: string;
  budgetVersionId: string;
  parentAllocationId: string | null;
  recipientJurisdictionId: string;
  recipient: { code: string; name: string } | null;
  schemeId: string | null;
  scheme: { schemeCode: string; name: string } | null;
  level: 'JURISDICTION' | 'SUB_JURISDICTION' | 'SCHEME';
  amount: string;
  status: string;
  allocatedApproved: string;
  allocatedPending: string;
  remaining: string;
  available: string;
  createdBy: string | null;
  version: number;
}
export interface Revision {
  id: string;
  targetType: string;
  budgetVersionId: string | null;
  allocationId: string | null;
  previousAmount: string;
  requestedAmount: string;
  reason: string;
  status: string;
  requestedBy: string;
  decisionComment: string | null;
}
export interface FundingRequest {
  id: string;
  schemeId: string;
  scheme: { schemeCode: string; name: string };
  period: { code: string };
  amount: string;
  justification: string;
  status: string;
  submittedById: string | null;
  version: number;
}
