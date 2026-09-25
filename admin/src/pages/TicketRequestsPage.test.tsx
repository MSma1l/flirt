import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TicketRequestsPage } from './TicketRequestsPage';
import type { TicketRequest } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const REQUEST: TicketRequest = {
  id: 'request-12345678', event_id: 'event-1', event_title: 'Flirt Party', event_starts_at: '2026-10-10T20:00:00Z', event_venue: 'Club',
  full_name: 'Ana Popescu', phone: '+37360000000', email: 'ana@example.com',
  ticket_quantity: 2, ticket_price: 250, total_amount: 500,
  currency: 'MDL', payment_description: 'Bilet Flirt Party – 2026-10-10 – Ana Popescu',
  payment_proof_uploaded: false, status: 'payment_proof_submitted', client_message: 'Mulțumesc.',
  admin_comment: null, reviewed_at: null,
  created_at: '2026-09-20T10:00:00Z',
};

describe('TicketRequestsPage', () => {
  it('trimite filtrul de status către coada de cereri', async () => {
    seedAdminSession();
    const api = mockFetch({ 'GET /admin/ticket-requests': { body: [REQUEST] } });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await screen.findByText('Ana Popescu');
    await person.selectOptions(screen.getByLabelText('Status'), 'approved');
    await waitFor(() => expect(api.calls.filter((call) => call.url.includes('status=approved'))).toHaveLength(1));
  });

  it('nu acceptă până când administratorul confirmă și păstrează comentariul', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/ticket-requests': { body: [REQUEST] },
      'GET /admin/ticket-requests/request-12345678': { body: REQUEST },
      'POST /admin/ticket-requests/request-12345678/review': { body: { ...REQUEST, status: 'approved' } },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await screen.findByText('Ana Popescu');
    await person.click(screen.getByRole('button', { name: 'Deschide' }));
    await screen.findByRole('dialog', { name: 'Cerere request-' });
    await person.click(screen.getByRole('button', { name: 'Acceptă plata' }));
    expect(api.callsTo('POST /admin/ticket-requests/request-12345678/review')).toHaveLength(0);
    const dialogs = screen.getAllByRole('dialog');
    const reviewDialog = dialogs[dialogs.length - 1]!;
    await person.type(within(reviewDialog).getByLabelText('Comentariu pentru client'), 'Transfer verificat.');
    await person.click(within(reviewDialog).getByRole('button', { name: 'Acceptă plata' }));
    await waitFor(() => expect(api.callsTo('POST /admin/ticket-requests/request-12345678/review')).toHaveLength(1));
    expect(api.callsTo('POST /admin/ticket-requests/request-12345678/review')[0]?.body).toEqual({ status: 'approved', admin_comment: 'Transfer verificat.' });
  });
});
