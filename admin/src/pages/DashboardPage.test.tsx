import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardPage } from './DashboardPage';
import { STATS_FIXTURE, mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

describe('DashboardPage', () => {
  it('randează statisticile primite de la backend', async () => {
    seedAdminSession();
    mockFetch({
      'GET /admin/stats': { body: STATS_FIXTURE },
      'GET /admin/stats/timeseries': {
        body: [
          { date: '2026-07-01', users: 10, matches: 22, reports: 1, revenue_eur: 40 },
          { date: '2026-07-02', users: 14, matches: 30, reports: 0, revenue_eur: 55 },
        ],
      },
      'GET /admin/me': { body: { id: '1', email: 'admin@flirt.app', role: 'admin' } },
    });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Utilizatori')).toBeInTheDocument();
    expect(screen.getByText('Match-uri')).toBeInTheDocument();
    expect(screen.getByText('Rapoarte în așteptare')).toBeInTheDocument();
    expect(screen.getByText('Abonamente active')).toBeInTheDocument();
    expect(screen.getByText('Venit estimat')).toBeInTheDocument();

    // Valorile ajung formatate, nu brute.
    expect(screen.getByText(new Intl.NumberFormat('ro-RO').format(1284))).toBeInTheDocument();
    expect(screen.getByText(new Intl.NumberFormat('ro-RO').format(4210))).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('afișează o eroare lizibilă când statisticile cad', async () => {
    seedAdminSession();
    mockFetch({
      'GET /admin/stats': { status: 500, body: { detail: 'Boom' } },
      'GET /admin/stats/timeseries': { body: [] },
    });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
});
