import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TicketOrdersPage } from './TicketOrdersPage';
import type { PaymentSettings, TicketOrder } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const SETTINGS: PaymentSettings = {
  bank_beneficiary: 'FLIRT SRL',
  bank_iban: 'MD24AG000000225100013104',
  bank_name: 'Banca de Test',
  instructions: 'Treci referința în detaliile plății.',
};

const ORDER: TicketOrder = {
  id: 'ord-1',
  status: 'payment_declared',
  price: 25,
  currency: 'EUR',
  reference: 'FLT-7788',
  user_note: 'Am plătit azi dimineață.',
  created_at: '2026-07-20T10:00:00Z',
  user: { email: 'user@example.com', payment_ref: 'PAY-42' },
  event: { title: 'Party FLIRT', starts_at: '2026-08-01T20:00:00Z' },
};

describe('TicketOrdersPage', () => {
  it('aprobă o comandă doar după confirmare', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/payment-settings': { body: SETTINGS },
      'GET /admin/ticket-orders': { body: [ORDER] },
      'POST /admin/ticket-orders/ord-1/approve': {
        body: { ...ORDER, status: 'approved', ticket_code: 'TCK-1' },
      },
    });
    const person = userEvent.setup();

    renderWithProviders(<TicketOrdersPage />);
    await screen.findByText('Party FLIRT');

    await person.click(screen.getByRole('button', { name: 'Aprobă' }));
    const dialog = await screen.findByRole('dialog');
    // Nimic nu pleacă spre backend înainte de confirmare.
    expect(api.callsTo('POST /admin/ticket-orders/ord-1/approve')).toHaveLength(0);

    await person.click(
      within(dialog).getByRole('button', { name: 'Aprobă și generează biletul' }),
    );
    await waitFor(() => {
      expect(api.callsTo('POST /admin/ticket-orders/ord-1/approve')).toHaveLength(1);
    });
  });

  it('respinge o comandă cu motiv opțional', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/payment-settings': { body: SETTINGS },
      'GET /admin/ticket-orders': { body: [ORDER] },
      'POST /admin/ticket-orders/ord-1/reject': {
        body: { ...ORDER, status: 'rejected' },
      },
    });
    const person = userEvent.setup();

    renderWithProviders(<TicketOrdersPage />);
    await screen.findByText('Party FLIRT');

    await person.click(screen.getByRole('button', { name: 'Respinge' }));
    const dialog = await screen.findByRole('dialog');

    await person.type(
      within(dialog).getByLabelText('Motiv (opțional)'),
      'Plata nu a fost găsită.',
    );
    await person.click(within(dialog).getByRole('button', { name: 'Respinge comanda' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/ticket-orders/ord-1/reject')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/ticket-orders/ord-1/reject')[0]?.body).toMatchObject({
      reason: 'Plata nu a fost găsită.',
    });
  });

  it('salvează datele bancare prin PUT', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/payment-settings': { body: SETTINGS },
      'GET /admin/ticket-orders': { body: [] },
      'PUT /admin/payment-settings': {
        body: { ...SETTINGS, bank_beneficiary: 'FLIRT International SRL' },
      },
    });
    const person = userEvent.setup();

    renderWithProviders(<TicketOrdersPage />);
    const beneficiary = await screen.findByLabelText('Beneficiar *');

    await person.clear(beneficiary);
    await person.type(beneficiary, 'FLIRT International SRL');
    await person.click(screen.getByRole('button', { name: 'Salvează datele bancare' }));

    await waitFor(() => {
      expect(api.callsTo('PUT /admin/payment-settings')).toHaveLength(1);
    });
    expect(api.callsTo('PUT /admin/payment-settings')[0]?.body).toMatchObject({
      bank_beneficiary: 'FLIRT International SRL',
      bank_iban: 'MD24AG000000225100013104',
    });
  });
});
