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

export interface SchemeRef {
  id: string;
  schemeCode: string;
  name: string;
}

export interface FundRelease {
  id: string;
  scheme: SchemeRef;
  amount: string;
  releaseDate: string;
  reference: string;
  verificationStatus: string;
  supersedesId: string | null;
  correctionReason: string | null;
  decisionReason: string | null;
  createdBy: string;
  version: number;
}

export interface ExpenditureRecord {
  id: string;
  scheme: SchemeRef;
  period: { id: string; code: string };
  amount: string;
  expenditureDate: string;
  reference: string;
  status: string;
  supersedesId: string | null;
  correctionReason: string | null;
  decisionReason: string | null;
  submittedById: string | null;
  version: number;
}

export interface SchemeFinance {
  approvedBudget: string | null;
  verifiedReleases: string;
  pendingReleases: string;
  verifiedExpenditure: string;
  reportedUnverifiedExpenditure: string;
  openCommitments: string;
  budgetBalance: string | null;
  releaseBalance: string;
  budgetUtilisationPercent: string | null;
  releaseUtilisationPercent: string | null;
  basis: string;
}

export interface SchemeProgress {
  physicalCompletionPercent: string | null;
  lastVerifiedPeriod: string | null;
  basis: string;
  milestones: {
    id: string;
    name: string;
    unit: string;
    weight: string;
    targetQuantity: string;
    verifiedQuantity: string | null;
  }[];
}

export interface ProgressSubmission {
  id: string;
  period: { id: string; code: string };
  submissionVersion: number;
  status: string;
  remarks: string | null;
  decisionReason: string | null;
  createdBy: string;
  version: number;
  measurements: { milestoneId: string; quantityCompleted: string; milestone: { name: string } }[];
}

export interface QueueItem {
  kind: 'FUND_RELEASE' | 'EXPENDITURE' | 'PROGRESS';
  id: string;
  scheme: SchemeRef;
  status: string;
  amount?: string;
  reference?: string;
  period?: string;
  isCorrection: boolean;
  correctionReason?: string | null;
  version: number;
}
