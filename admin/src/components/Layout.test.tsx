import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';

import { Layout } from './Layout';
import { TicketOrdersPage } from '../pages/TicketOrdersPage';
import type { PaymentSettings } from '../api/types';
import { STATS_FIXTURE, mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const SETTINGS: PaymentSettings = {
  bank_beneficiary: 'FLIRT SRL',
  bank_iban: 'MD24AG000000225100013104',
  bank_name: 'Banca de Test',
  instructions: '',
};

function renderAdmin(): void {
  renderWithProviders(
    <Routes>
      <Route element={<Layout />}>
        <Route path="/ticket-orders" element={<TicketOrdersPage />} />
        <Route path="/dashboard" element={<p>Panou</p>} />
      </Route>
    </Routes>,
    { route: '/dashboard' },
  );
}

describe('Layout — semnul „vânzare online oprită"', () => {
  it('apare lângă „Comenzi bilete" când vânzarea e oprită', async () => {
    seedAdminSession();
    mockFetch({
      'GET /admin/stats': { body: STATS_FIXTURE },
      'GET /admin/payment-settings': { body: { ...SETTINGS, online_sales_enabled: false } },
    });
    renderAdmin();

    const indicator = await screen.findByTestId('sales-off-indicator');
    expect(indicator).toHaveTextContent('Oprită');
    expect(indicator).toHaveAttribute('title', 'Vânzarea online a biletelor este OPRITĂ');
    expect(screen.getByRole('link', { name: /Comenzi bilete/ })).toContainElement(indicator);
  });

  it('lipsește când vânzarea e activă (sau serverul nu trimite câmpul)', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/stats': { body: STATS_FIXTURE },
      'GET /admin/payment-settings': { body: SETTINGS },
    });
    renderAdmin();

    await waitFor(() => expect(api.callsTo('GET /admin/payment-settings')).toHaveLength(1));
    await screen.findByText('Panou', { selector: 'p' });
    expect(screen.queryByTestId('sales-off-indicator')).not.toBeInTheDocument();
  });

  it('apare imediat după oprirea din pagina de comenzi', async () => {
    seedAdminSession();
    mockFetch({
      'GET /admin/stats': { body: STATS_FIXTURE },
      'GET /admin/ticket-orders': { body: [] },
      'GET /admin/payment-settings': { body: { ...SETTINGS, online_sales_enabled: true } },
      'PUT /admin/payment-settings/online-sales': {
        body: { ...SETTINGS, online_sales_enabled: false },
      },
    });
    const person = userEvent.setup();
    renderAdmin();

    await person.click(await screen.findByRole('link', { name: /Comenzi bilete/ }));
    await person.click(await screen.findByRole('button', { name: 'Oprește vânzarea online' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.queryByTestId('sales-off-indicator')).not.toBeInTheDocument();
    await person.click(within(dialog).getByRole('button', { name: 'Da, oprește vânzarea' }));

    expect(await screen.findByTestId('sales-off-indicator')).toBeInTheDocument();
  });
});
