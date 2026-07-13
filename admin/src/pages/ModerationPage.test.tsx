import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ModerationPage } from './ModerationPage';
import type { AdminReport } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const REPORT: AdminReport = {
  id: 'r-1',
  reporter_id: 'u-2',
  reported_id: 'u-1',
  category: 'harassment',
  note: 'Mesaje ofensatoare în chat',
  status: 'open',
  created_at: new Date().toISOString(),
  reporters_count: 3,
  reported: {
    user_id: 'u-1',
    email: 'raportat@flirt.app',
    name: 'Andrei',
    age: 29,
    city: 'Cluj',
    about: 'Bio de test',
    photos: [],
    banned_at: null,
  },
};

describe('ModerationPage', () => {
  it('afișează coada de rapoarte cu numărul de raportori și detaliile profilului', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/reports': { body: [REPORT] } });

    renderWithProviders(<ModerationPage />);

    expect(await screen.findByText('Rapoarte deschise (1)')).toBeInTheDocument();
    expect(screen.getAllByText('3 raportări').length).toBeGreaterThan(0);
    expect(screen.getByText('raportat@flirt.app')).toBeInTheDocument();
    // Nota apare și în coadă, și în panoul de detalii.
    expect(screen.getAllByText('Mesaje ofensatoare în chat').length).toBeGreaterThan(0);
  });

  it('NU banează fără confirmare — cererea pleacă abia după confirmarea din dialog', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/reports': { body: [REPORT] },
      'POST /admin/reports/r-1/resolve': { status: 204 },
      'GET /admin/stats': { body: null },
    });
    const user = userEvent.setup();

    renderWithProviders(<ModerationPage />);
    await screen.findByText('Rapoarte deschise (1)');

    await user.click(screen.getByRole('button', { name: 'Banează contul' }));

    // Dialogul e deschis, dar backend-ul NU a fost apelat.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(api.callsTo('POST /admin/reports/r-1/resolve')).toHaveLength(0);

    // Anulare → tot nimic.
    await user.click(screen.getByRole('button', { name: 'Anulează' }));
    expect(api.callsTo('POST /admin/reports/r-1/resolve')).toHaveLength(0);

    // Confirmare → acum pleacă acțiunea, cu tipul corect.
    await user.click(screen.getByRole('button', { name: 'Banează contul' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Banează contul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/reports/r-1/resolve')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/reports/r-1/resolve')[0]?.body).toMatchObject({
      action: 'ban',
    });
  });

  it('respinge raportul doar după confirmare', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/reports': { body: [REPORT] },
      'POST /admin/reports/r-1/resolve': { status: 204 },
      'GET /admin/stats': { body: null },
    });
    const user = userEvent.setup();

    renderWithProviders(<ModerationPage />);
    await screen.findByText('Rapoarte deschise (1)');

    await user.click(screen.getByRole('button', { name: 'Respinge raportul' }));
    const dialog = await screen.findByRole('dialog');
    expect(api.callsTo('POST /admin/reports/r-1/resolve')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Respinge raportul' }));
    await waitFor(() => {
      expect(api.callsTo('POST /admin/reports/r-1/resolve')[0]?.body).toMatchObject({
        action: 'dismiss',
      });
    });
  });
});
