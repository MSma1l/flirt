import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EventsPage } from './EventsPage';
import type { AdminEvent } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const EVENT: AdminEvent = {
  id: 'e-1',
  title: 'Seară de stand-up',
  description: null,
  starts_at: '2026-08-01T18:00:00Z',
  city: 'București',
  venue: 'Club X',
  lat: null,
  lng: null,
  kind: 'party',
  cover_url: null,
  attendee_count: 12,
  promo_discount_percent: null,
  promo_code: null,
  promo_description: null,
  ticket_price: null,
  ticket_currency: null,
};

describe('EventsPage', () => {
  it('creează un eveniment nou cu payload-ul corect', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    await person.click(screen.getByRole('button', { name: 'Eveniment nou' }));
    const dialog = await screen.findByRole('dialog');

    await person.type(within(dialog).getByLabelText('Titlu *'), 'Seară de stand-up');
    await person.type(within(dialog).getByLabelText('Oraș *'), 'București');
    await person.type(within(dialog).getByLabelText('Data și ora *'), '2026-08-01T21:00');
    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/events')[0]?.body).toMatchObject({
      title: 'Seară de stand-up',
      city: 'București',
      kind: 'flirt_party',
    });
  });

  it('trimite prețul biletului și moneda în payload', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    await person.click(screen.getByRole('button', { name: 'Eveniment nou' }));
    const dialog = await screen.findByRole('dialog');

    await person.type(within(dialog).getByLabelText('Titlu *'), 'Gală');
    await person.type(within(dialog).getByLabelText('Oraș *'), 'Cluj');
    await person.type(within(dialog).getByLabelText('Data și ora *'), '2026-08-01T21:00');
    await person.type(within(dialog).getByLabelText('Preț bilet'), '50');
    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/events')[0]?.body).toMatchObject({
      ticket_price: 50,
      ticket_currency: 'lei',
    });
  });

  it('lasă prețul null când câmpul e gol (bilet online indisponibil)', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    await person.click(screen.getByRole('button', { name: 'Eveniment nou' }));
    const dialog = await screen.findByRole('dialog');

    await person.type(within(dialog).getByLabelText('Titlu *'), 'Fără bilet');
    await person.type(within(dialog).getByLabelText('Oraș *'), 'Iași');
    await person.type(within(dialog).getByLabelText('Data și ora *'), '2026-08-01T21:00');
    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    const body = api.callsTo('POST /admin/events')[0]?.body as Record<string, unknown>;
    expect(body.ticket_price).toBeNull();
    expect(body.ticket_currency).toBeNull();
  });

  it('nu șterge un eveniment fără confirmare', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [EVENT] },
      'DELETE /admin/events/e-1': { status: 204 },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Seară de stand-up');

    await person.click(screen.getByRole('button', { name: 'Șterge' }));
    const dialog = await screen.findByRole('dialog');
    expect(api.callsTo('DELETE /admin/events/e-1')).toHaveLength(0);

    await person.click(within(dialog).getByRole('button', { name: 'Șterge evenimentul' }));
    await waitFor(() => {
      expect(api.callsTo('DELETE /admin/events/e-1')).toHaveLength(1);
    });
  });
});
