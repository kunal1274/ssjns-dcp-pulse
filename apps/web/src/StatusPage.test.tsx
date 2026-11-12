import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusPage } from './StatusPage';

const ready = {
  status: 'ok',
  service: 'dcp-pulse-api',
  timestamp: '2026-11-12T10:00:00.000Z',
  checks: {
    database: { status: 'up', postgisVersion: '3.4.2' },
    migrations: { status: 'up', applied: 2, pending: 0 },
  },
};

const mockFetch = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('StatusPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('always shows the synthetic-data disclaimer', async () => {
    mockFetch(200, ready);
    render(<StatusPage />);
    expect(screen.getByRole('note')).toHaveTextContent(/Synthetic demonstration data/);
    await screen.findByText('Ready');
  });

  it('renders readiness checks from the API', async () => {
    const fetchSpy = mockFetch(200, ready);
    render(<StatusPage />);
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('PostGIS 3.4.2')).toBeInTheDocument();
    expect(screen.getByText('2 applied, 0 pending')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/health/ready', expect.anything());
  });

  it('shows "Not ready" when the API reports a failing dependency (503)', async () => {
    mockFetch(503, {
      ...ready,
      status: 'error',
      checks: {
        database: { status: 'down', error: 'database or PostGIS unavailable' },
        migrations: { status: 'down' },
      },
    });
    render(<StatusPage />);
    expect(await screen.findByText('Not ready')).toBeInTheDocument();
  });

  it('shows an alert when the API is unreachable, and can retry', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<StatusPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('API unreachable: Failed to fetch');

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(ready), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
  });

  it('does not render any dashboard, chart or KPI content', async () => {
    mockFetch(200, ready);
    const { container } = render(<StatusPage />);
    await screen.findByText('Ready');
    expect(container.querySelector('canvas, svg')).toBeNull();
    expect(container.textContent).not.toMatch(/utili[sz]ation|crore|lakh|₹/i);
  });
});
