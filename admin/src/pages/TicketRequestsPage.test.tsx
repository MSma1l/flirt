import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TicketRequestsPage } from './TicketRequestsPage';
import type { TicketRequest } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const REQUEST: TicketRequest = {
  id: 'request-12345678', event_id: 'event-1', event_title: 'Flirt Party', event_starts_at: '2026-10-10T20:00:00Z', event_venue: 'Club',
  full_name: 'Ana Popescu', phone: '+37360000000', email: 'ana@example.com',
  ticket_quantity: 2, ticket_price: 250, total_amount: 500,
  currency: 'MDL', payment_description: 'Bilet Flirt Party – 2026-10-10 – Ana Popescu',
  payment_proof_uploaded: true, status: 'payment_proof_submitted', client_message: 'Mulțumesc.',
  admin_comment: null, reviewed_at: null,
  created_at: '2026-09-20T10:00:00Z',
};

const APPROVED: TicketRequest = {
  ...REQUEST,
  id: 'request-approved1',
  full_name: 'Ion Rusu',
  status: 'approved',
  ticket_code: 'abcdef0123',
  ticket_status: 'valid',
};

const COUNTS = {
  counts: {
    awaiting_payment: 0, pending_payment: 0, payment_declared: 0, payment_proof_submitted: 1,
    under_review: 0, additional_information_required: 0, approved: 1, rejected: 0, cancelled: 0,
  },
  total: 2,
};

const EVENTS = {
  'GET /admin/events': { body: [] },
  'GET /admin/ticket-requests/counts': { body: COUNTS },
};

describe('TicketRequestsPage', () => {
  beforeEach(() => {
    seedAdminSession();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:proof') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('trimite starea la server și arată contoarele exacte pe fiecare filtru', async () => {
    const api = mockFetch({
      ...EVENTS,
      'GET /admin/ticket-requests': (call) => {
        const status = new URL(call.url).searchParams.get('status');
        if (status === 'approved') return { body: [APPROVED] };
        return { body: [REQUEST, APPROVED] };
      },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);

    await screen.findByText('Ana Popescu');
    expect(screen.getByText('Ion Rusu')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('chip-count-toVerify')).toHaveTextContent('1'));
    expect(screen.getByTestId('chip-count-all')).toHaveTextContent('2');
    expect(screen.getByTestId('chip-count-approved')).toHaveTextContent('1');
    // Cererea care cere acțiune iese în evidență.
    expect(screen.getByTestId('ticket-request-row-request-12345678')).toHaveClass('ticket-row--action');

    const filters = screen.getByRole('group', { name: 'Status' });
    await person.click(within(filters).getByRole('button', { name: /^Acceptată/ }));
    await waitFor(() => expect(screen.queryByText('Ana Popescu')).not.toBeInTheDocument());
    expect(screen.getByText('Ion Rusu')).toBeInTheDocument();
    expect(screen.getByText('Bilet valid')).toBeInTheDocument();
    expect(new URL(api.callsTo('GET /admin/ticket-requests').at(-1)!.url).searchParams.get('status')).toBe('approved');

    // „De verificat" = mai multe stări, într-un singur `?status=a,b,c`.
    await person.click(within(filters).getByRole('button', { name: /^De verificat/ }));
    await waitFor(() =>
      expect(new URL(api.callsTo('GET /admin/ticket-requests').at(-1)!.url).searchParams.get('status')).toBe(
        'payment_declared,payment_proof_submitted,under_review',
      ),
    );
  });

  it('filtrul de eveniment pleacă la server, pentru listă și contoare', async () => {
    const api = mockFetch({
      ...EVENTS,
      'GET /admin/events': {
        body: [{ id: 'event-1', title: 'Flirt Party', starts_at: '2026-10-10T20:00:00Z' }],
      },
      'GET /admin/ticket-requests': { body: [REQUEST] },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await screen.findByText('Ana Popescu');

    const select = screen.getByLabelText('Eveniment');
    // Data evenimentului e în ora Chișinăului (20:00Z → 23:00).
    await waitFor(() => expect(within(select).getByRole('option', { name: /Flirt Party · .*23:00/ })).toBeInTheDocument());
    await person.selectOptions(select, 'event-1');
    await waitFor(() => {
      const last = api.callsTo('GET /admin/ticket-requests').at(-1)!;
      expect(new URL(last.url).searchParams.get('event_id')).toBe('event-1');
    });
    await waitFor(() => {
      const last = api.callsTo('GET /admin/ticket-requests/counts').at(-1)!;
      expect(new URL(last.url).searchParams.get('event_id')).toBe('event-1');
    });
  });

  it('acceptarea pe un eveniment epuizat arată un mesaj clar (409 tickets_sold_out)', async () => {
    mockFetch({
      ...EVENTS,
      'GET /admin/ticket-requests': { body: [REQUEST] },
      'GET /admin/ticket-requests/request-12345678': { body: REQUEST },
      'GET /admin/ticket-requests/request-12345678/payment-proof': { body: 'img' },
      'POST /admin/ticket-requests/request-12345678/review': {
        status: 409,
        body: { detail: 'Sold out', code: 'tickets_sold_out' },
      },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await person.click(await screen.findByRole('button', { name: 'Verifică' }));
    const detail = await screen.findByRole('dialog', { name: 'Cerere request-' });
    await person.click(await within(detail).findByRole('button', { name: 'Acceptă plata' }));
    const dialogs = screen.getAllByRole('dialog');
    const review = dialogs[dialogs.length - 1]!;
    await person.click(within(review).getByRole('button', { name: 'Acceptă plata' }));
    expect(await within(review).findByRole('alert')).toHaveTextContent(/Biletele s-au epuizat/);
  });

  it('„până la" include toată ziua aleasă (ora Chișinăului)', async () => {
    const api = mockFetch({ ...EVENTS, 'GET /admin/ticket-requests': { body: [REQUEST] } });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await screen.findByText('Ana Popescu');

    await person.type(screen.getByLabelText('Creată până la (inclusiv)'), '2026-09-20');
    await waitFor(() => {
      const last = api.callsTo('GET /admin/ticket-requests').at(-1)!;
      expect(new URL(last.url).searchParams.get('created_to')).toBe('2026-09-20T20:59:59.999Z');
    });
  });

  it('nu acceptă până când administratorul confirmă și păstrează comentariul', async () => {
    const api = mockFetch({
      ...EVENTS,
      'GET /admin/ticket-requests': { body: [REQUEST] },
      'GET /admin/ticket-requests/request-12345678': { body: REQUEST },
      'GET /admin/ticket-requests/request-12345678/payment-proof': { body: 'img' },
      'POST /admin/ticket-requests/request-12345678/review': { body: { ...REQUEST, status: 'approved' } },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await screen.findByText('Ana Popescu');
    await person.click(screen.getByRole('button', { name: 'Verifică' }));
    const detail = await screen.findByRole('dialog', { name: 'Cerere request-' });
    // Dovada se vede mare, lângă total.
    expect(await within(detail).findByTestId('proof-image')).toHaveAttribute('src', 'blob:proof');
    expect(within(detail).getByTestId('request-total')).toHaveTextContent(/500\sMDL/);

    await person.click(within(detail).getByRole('button', { name: 'Acceptă plata' }));
    expect(api.callsTo('POST /admin/ticket-requests/request-12345678/review')).toHaveLength(0);
    const dialogs = screen.getAllByRole('dialog');
    const reviewDialog = dialogs[dialogs.length - 1]!;
    expect(reviewDialog).toHaveTextContent('Se rezervă 2 bilete pentru Ana Popescu');
    await person.type(within(reviewDialog).getByLabelText('Comentariu pentru client'), 'Transfer verificat.');
    await person.click(within(reviewDialog).getByRole('button', { name: 'Acceptă plata' }));
    await waitFor(() => expect(api.callsTo('POST /admin/ticket-requests/request-12345678/review')).toHaveLength(1));
    expect(api.callsTo('POST /admin/ticket-requests/request-12345678/review')[0]?.body).toEqual({ status: 'approved', admin_comment: 'Transfer verificat.' });
    // După decizie, lista se reîncarcă (nu rămâne „de verificat").
    await waitFor(() => expect(api.callsTo('GET /admin/ticket-requests').length).toBeGreaterThan(1));
  });

  it('fără dovadă: „Acceptă plata" e blocat; refuzul cere un mesaj pentru client', async () => {
    const noProof: TicketRequest = { ...REQUEST, payment_proof_uploaded: false, status: 'pending_payment' };
    const api = mockFetch({
      ...EVENTS,
      'GET /admin/ticket-requests': { body: [noProof] },
      'GET /admin/ticket-requests/request-12345678': { body: noProof },
      'POST /admin/ticket-requests/request-12345678/review': { body: { ...noProof, status: 'rejected' } },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await screen.findByText('Ana Popescu');
    await person.click(screen.getByRole('button', { name: 'Deschide' }));
    const detail = await screen.findByRole('dialog', { name: 'Cerere request-' });

    expect(await within(detail).findByRole('button', { name: 'Acceptă plata' })).toBeDisabled();
    await person.click(within(detail).getByRole('button', { name: 'Refuză' }));
    const dialogs = screen.getAllByRole('dialog');
    const review = dialogs[dialogs.length - 1]!;
    const submit = within(review).getByRole('button', { name: 'Refuză cererea' });
    expect(submit).toBeDisabled();
    await person.type(within(review).getByLabelText('Mesaj pentru client (obligatoriu)'), 'Plata lipsește.');
    await person.click(submit);
    await waitFor(() => expect(api.callsTo('POST /admin/ticket-requests/request-12345678/review')).toHaveLength(1));
  });

  it('o cerere acceptată e închisă: fără acțiuni', async () => {
    mockFetch({
      ...EVENTS,
      'GET /admin/ticket-requests': { body: [APPROVED] },
      'GET /admin/ticket-requests/request-approved1': { body: APPROVED },
      'GET /admin/ticket-requests/request-approved1/payment-proof': { body: 'img' },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await person.click(await screen.findByRole('button', { name: 'Deschide' }));
    const detail = await screen.findByRole('dialog');
    expect(await within(detail).findByTestId('request-final')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Refuză' })).toBeNull();
    expect(within(detail).getByText('abcdef0123')).toBeInTheDocument();
  });
});

describe('TicketRequestsPage — paginare pe cursor', () => {
  beforeEach(() => seedAdminSession());

  it('„Încarcă mai multe" aduce pagina următoare, fără dubluri', async () => {
    const api = mockFetch({
      ...EVENTS,
      'GET /admin/ticket-requests': (call) => {
        const cursor = new URL(call.url).searchParams.get('cursor');
        if (cursor === 'c2') return { body: [REQUEST, APPROVED] };
        return { body: [REQUEST], headers: { 'X-Next-Cursor': 'c2' } };
      },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketRequestsPage />);
    await screen.findByText('Ana Popescu');
    expect(screen.queryByText(/cele mai noi/)).toBeNull();
    expect(new URL(api.callsTo('GET /admin/ticket-requests')[0]!.url).searchParams.get('limit')).toBe('50');

    await person.click(screen.getByRole('button', { name: 'Încarcă mai multe' }));
    expect(await screen.findByText('Ion Rusu')).toBeInTheDocument();
    expect(screen.getAllByText('Ana Popescu')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Încarcă mai multe' })).toBeNull();
  });
});
