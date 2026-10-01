import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TicketOrdersPage, normalizeMdPhone } from './TicketOrdersPage';
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

  it('salvează datele de plată prin PUT', async () => {
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
    await person.click(screen.getByRole('button', { name: 'Salvează datele de plată' }));

    await waitFor(() => {
      expect(api.callsTo('PUT /admin/payment-settings')).toHaveLength(1);
    });
    expect(api.callsTo('PUT /admin/payment-settings')[0]?.body).toMatchObject({
      bank_beneficiary: 'FLIRT International SRL',
      bank_iban: 'MD24AG000000225100013104',
    });
  });

  it('salvează doar MIA: telefon normalizat, IBAN opțional', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/payment-settings': {
        body: { ...SETTINGS, bank_beneficiary: '', bank_iban: '', bank_name: '' },
      },
      'GET /admin/ticket-orders': { body: [] },
      'PUT /admin/payment-settings': {
        body: {
          ...SETTINGS,
          bank_beneficiary: '',
          bank_iban: '',
          mia_phone: '+37369123456',
          mia_recipient_name: 'Ion Popescu',
          mia_enabled: true,
          payment_methods: ['mia'],
        },
      },
    });
    const person = userEvent.setup();

    renderWithProviders(<TicketOrdersPage />);
    const phone = await screen.findByLabelText('Telefon MIA');
    const saveButton = screen.getByRole('button', { name: 'Salvează datele de plată' });
    // Nicio metodă configurată → nu se poate salva.
    expect(saveButton).toBeDisabled();
    // Fără telefon MIA, IBAN-ul și beneficiarul sunt obligatorii.
    expect(screen.getByLabelText('IBAN *')).toBeInTheDocument();

    await person.type(phone, '123');
    expect(screen.getByRole('alert')).toHaveTextContent('Număr invalid');
    expect(saveButton).toBeDisabled();

    await person.clear(phone);
    await person.type(phone, '069 123 456');
    await person.type(screen.getByLabelText('Numele destinatarului'), 'Ion Popescu');
    // Cu telefon MIA, IBAN-ul devine opțional.
    expect(screen.getByLabelText('IBAN')).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    await person.click(saveButton);

    await waitFor(() => {
      expect(api.callsTo('PUT /admin/payment-settings')).toHaveLength(1);
    });
    expect(api.callsTo('PUT /admin/payment-settings')[0]?.body).toMatchObject({
      mia_phone: '+37369123456',
      mia_recipient_name: 'Ion Popescu',
      bank_beneficiary: '',
      bank_iban: '',
      bank_name: null,
    });
  });
});

describe('TicketOrdersPage — codul QR MIA', () => {
  it('încarcă un QR (IBAN devine opțional), apoi îl poate șterge', async () => {
    seedAdminSession();
    const EMPTY = { ...SETTINGS, bank_beneficiary: '', bank_iban: '', bank_name: '' };
    const WITH_QR = {
      ...EMPTY,
      mia_qr_url: 'https://media.example/photos/payment-qr/abc.png',
      mia_enabled: true,
      payment_methods: ['mia'],
    };
    const api = mockFetch({
      'GET /admin/payment-settings': { body: EMPTY },
      'GET /admin/ticket-orders': { body: [] },
      'POST /admin/payment-settings/mia-qr': { body: WITH_QR },
      'DELETE /admin/payment-settings/mia-qr': { body: { ...WITH_QR, mia_qr_url: null } },
    });
    const person = userEvent.setup();

    renderWithProviders(<TicketOrdersPage />);
    const input = await screen.findByLabelText('Încarcă codul QR');
    expect(screen.getByText('Niciun cod QR încărcat.')).toBeInTheDocument();

    // Tip greșit → refuzat local, fără cerere.
    await person.upload(input, new File(['x'], 'qr.gif', { type: 'image/gif' }));
    expect(api.callsTo('POST /admin/payment-settings/mia-qr')).toHaveLength(0);

    await person.upload(input, new File(['png'], 'qr.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(api.callsTo('POST /admin/payment-settings/mia-qr')).toHaveLength(1);
    });
    expect(await screen.findByTestId('mia-qr-preview')).toHaveAttribute('src', WITH_QR.mia_qr_url);
    // Cu QR, MIA e configurat: IBAN-ul nu mai e obligatoriu și se poate salva.
    expect(screen.getByLabelText('IBAN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvează datele de plată' })).toBeEnabled();

    await person.click(screen.getByRole('button', { name: 'Șterge QR-ul' }));
    await waitFor(() => {
      expect(api.callsTo('DELETE /admin/payment-settings/mia-qr')).toHaveLength(1);
    });
    expect(await screen.findByText('Niciun cod QR încărcat.')).toBeInTheDocument();
  });
});

describe('normalizeMdPhone', () => {
  it('acceptă formatele moldovenești uzuale', () => {
    for (const raw of ['069123456', '69123456', '+373 69 123 456', '37369123456', '0037369123456']) {
      expect(normalizeMdPhone(raw)).toBe('+37369123456');
    }
  });

  it('respinge numerele invalide', () => {
    for (const raw of ['', '123', '+3736912345', '+40712345678', '0691234567']) {
      expect(normalizeMdPhone(raw)).toBeNull();
    }
  });
});

describe('TicketOrdersPage — detaliul comenzii', () => {
  const DETAIL: TicketOrder = {
    ...ORDER,
    id: 'ord-2',
    reference: 'U-ABCD1234',
    payment_proof_uploaded: true,
    payment_proof_kind: 'image',
    payment_method: 'mia',
    payment_declared_at: '2026-07-20T11:00:00Z',
    allowed_statuses: [
      'awaiting_payment',
      'additional_information_required',
      'approved',
      'rejected',
      'cancelled',
    ],
  };

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:proof'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });
  afterEach(() => vi.restoreAllMocks());

  it('deschide comanda din tabel, arată chitanța și cere informații', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/payment-settings': { body: SETTINGS },
      'GET /admin/ticket-orders': { body: [DETAIL] },
      'GET /admin/ticket-orders/ord-2': { body: DETAIL },
      'GET /admin/ticket-orders/ord-2/payment-proof': { body: 'img' },
      'POST /admin/ticket-orders/ord-2/status': {
        body: { ...DETAIL, status: 'additional_information_required', allowed_statuses: [] },
      },
    });
    const person = userEvent.setup();

    renderWithProviders(<TicketOrdersPage />);
    // Indicatorul de chitanță în tabel.
    expect(await screen.findByLabelText('Chitanță încărcată')).toBeInTheDocument();

    await person.click(screen.getByTestId('ticket-order-row-ord-2'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('MIA – plăți instant')).toBeInTheDocument();
    expect(await within(dialog).findByTestId('proof-image')).toHaveAttribute('src', 'blob:proof');
    expect(api.callsTo('GET /admin/ticket-orders/ord-2/payment-proof')).toHaveLength(1);

    await person.click(within(dialog).getByRole('button', { name: 'Cere informații' }));
    const dialogs = await screen.findAllByRole('dialog');
    const action = dialogs[dialogs.length - 1]!;
    const apply = within(action).getByRole('button', { name: 'Aplică' });
    // Mesajul pentru client e obligatoriu la „necesită informații".
    expect(apply).toBeDisabled();
    await person.type(within(action).getByLabelText('Mesaj pentru client'), 'Trimite chitanța completă.');
    await person.click(apply);

    await waitFor(() => {
      expect(api.callsTo('POST /admin/ticket-orders/ord-2/status')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/ticket-orders/ord-2/status')[0]?.body).toEqual({
      status: 'additional_information_required',
      note: 'Trimite chitanța completă.',
    });
  });

  it('schimbă statusul manual din listă și arată eroarea 409', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/payment-settings': { body: SETTINGS },
      'GET /admin/ticket-orders': { body: [DETAIL] },
      'GET /admin/ticket-orders/ord-2': { body: DETAIL },
      'GET /admin/ticket-orders/ord-2/payment-proof': { body: 'img' },
      'POST /admin/ticket-orders/ord-2/status': {
        status: 409,
        body: { detail: 'Tranziție nepermisă: payment_declared → cancelled.' },
      },
    });
    const person = userEvent.setup();

    renderWithProviders(<TicketOrdersPage />);
    await person.click(await screen.findByTestId('ticket-order-row-ord-2'));
    const dialog = await screen.findByRole('dialog');
    await person.selectOptions(within(dialog).getByLabelText('Schimbă statusul'), 'cancelled');
    await person.click(within(dialog).getByRole('button', { name: 'Aplică' }));

    const dialogs = await screen.findAllByRole('dialog');
    const action = dialogs[dialogs.length - 1]!;
    await person.click(within(action).getByRole('button', { name: 'Aplică' }));
    expect(await within(action).findByRole('alert')).toHaveTextContent('Tranziție nepermisă');
    expect(api.callsTo('POST /admin/ticket-orders/ord-2/status')[0]?.body).toEqual({
      status: 'cancelled',
    });
  });

  it('filtrează lista pe status', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/payment-settings': { body: SETTINGS },
      'GET /admin/ticket-orders': { body: [DETAIL] },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketOrdersPage />);
    await screen.findByTestId('ticket-order-row-ord-2');
    await person.selectOptions(screen.getByLabelText('Filtru status'), 'toVerify');
    await waitFor(() => {
      const urls = api.callsTo('GET /admin/ticket-orders').map((c) => c.url);
      expect(urls.some((u) => u.includes('status=payment_declared%2Cpayment_proof_submitted%2Cunder_review'))).toBe(true);
    });
  });

  it('o comandă finală nu mai oferă schimbări de status', async () => {
    seedAdminSession();
    const closed = { ...DETAIL, status: 'cancelled' as const, allowed_statuses: [], payment_proof_uploaded: false };
    mockFetch({
      'GET /admin/payment-settings': { body: SETTINGS },
      'GET /admin/ticket-orders': { body: [closed] },
      'GET /admin/ticket-orders/ord-2': { body: closed },
    });
    const person = userEvent.setup();
    renderWithProviders(<TicketOrdersPage />);
    await person.click(await screen.findByTestId('ticket-order-row-ord-2'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Comanda e finală — statusul nu mai poate fi schimbat.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Schimbă statusul')).toBeNull();
  });
});

