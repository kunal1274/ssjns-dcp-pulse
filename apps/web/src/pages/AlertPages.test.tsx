import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertsPage, CorrectiveActionDetailPage } from './AlertPages';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ can: () => false }) }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const alert = (over: object) => ({
  id: 'a1',
  ruleCode: 'PHYSICAL_FINANCIAL_GAP',
  severity: 'MEDIUM',
  status: 'OPEN',
  dedupKey: 'k',
  reviewIndicator: true,
  escalationLevel: 0,
  detectedAt: '2026-11-01T00:00:00Z',
  dueAt: null,
  lastEvaluatedAt: null,
  resolutionReason: null,
  contextJson: {},
  version: 1,
  scheme: { id: 's1', schemeCode: 'DEMO-001', name: 'Demo', jurisdiction: { name: 'CD-A1' } },
  assignee: null,
  ...over,
});

describe('F11 pages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('separates review indicators from control breaches and shows severity totals', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        total: 2,
        summary: { activeBySeverity: { HIGH: 1, MEDIUM: 1 }, byStatus: {} },
        items: [
          alert({}),
          alert({
            id: 'a2',
            ruleCode: 'RELEASE_EXCEEDED',
            severity: 'HIGH',
            reviewIndicator: false,
          }),
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={['/alerts']}>
        <AlertsPage />
      </MemoryRouter>,
    );
    expect(await screen.findAllByTestId('alert-row')).toHaveLength(2);
    expect(screen.getByText('Review indicator')).toBeInTheDocument();
    expect(screen.getByText('Control breach')).toBeInTheDocument();
    expect(screen.getByText(/not evidence of misuse/)).toBeInTheDocument();
    expect(screen.getByTestId('alert-summary')).toHaveTextContent('Active high1');
  });

  it('owner awaiting verification sees why they cannot verify and no verify button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        id: 'c1',
        actionText: 'Reconcile MB',
        status: 'PENDING_VERIFICATION',
        priority: 'MEDIUM',
        dueAt: '2026-12-01T00:00:00Z',
        evidenceNote: 'MB p12',
        closureReason: null,
        version: 3,
        owner: { id: 'u1', name: 'Officer', email: 'o@example.test' },
        scheme: null,
        alert: null,
        createdByName: 'Reviewer',
        verifiedByName: null,
        verifiedAt: null,
        events: [
          {
            id: 'e1',
            eventType: 'SUBMITTED_FOR_VERIFICATION',
            fromStatus: 'IN_PROGRESS',
            toStatus: 'PENDING_VERIFICATION',
            note: null,
            actorName: 'Officer',
            createdAt: '2026-11-02T00:00:00Z',
          },
        ],
        allowed: {
          addProgress: false,
          submitForVerification: false,
          edit: false,
          verify: false,
          verifyBlockedReason: 'The responsible officer cannot verify their own action.',
        },
      }),
    );
    render(
      <MemoryRouter initialEntries={['/corrective-actions/c1']}>
        <Routes>
          <Route path="/corrective-actions/:id" element={<CorrectiveActionDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/cannot verify their own action/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify and close' })).toBeNull();
    expect(screen.getByTestId('history')).toHaveTextContent('SUBMITTED FOR VERIFICATION');
  });
});
