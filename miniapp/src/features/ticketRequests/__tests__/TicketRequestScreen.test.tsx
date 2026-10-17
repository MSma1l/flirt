/**
 * Cererea manuală de bilete: starea cererilor existente, datele de plată după o
 * reîncărcare, formularul (cantitate, total, epuizare) și o cerere nouă după
 * una închisă.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventItem } from '@/features/events/eventsApi';
import type { PaymentInstructions } from '@/features/tickets/paymentModel';
import { renderWithProviders } from '@/test/harness';

import { TicketRequestScreen } from '../TicketRequestScreen';
import { TICKET_REQUEST_ROUTE_PATTERN, ticketRequestPath } from '../ticketRequestRoutes';
import type { TicketRequest } from '../ticketRequestsApi';

vi.mock('@/features/events/eventsApi', () => ({ fetchEvent: vi.fn() }));
vi.mock('@/features/tickets/ticketsApi', () => ({ fetchTicketOrder: vi.fn(), uploadOrderProof: vi.fn() }));
vi.mock('../ticketRequestsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ticketRequestsApi')>()),
  fetchMyTicketRequests: vi.fn(),
  createTicketRequest: vi.fn(),
  uploadPaymentProof: vi.fn(),
}));

const { fetchEvent } = await import('@/features/events/eventsApi');
const { fetchTicketOrder } = await import('@/features/tickets/ticketsApi');
const { createTicketRequest, fetchMyTicketRequests } = await import('../ticketRequestsApi');

const EVENT: EventItem = {
  id: 'e1',
  title: 'Flirt Party #7',
  description: '',
  startsAt: '2027-10-01T20:00:00Z',
  city: 'Chișinău',
  venue: 'Club Mono',
  kind: 'flirt_party',
  attendeeCount: 0,
  iAmGoing: false,
  promoDiscountPercent: null,
  promoCode: null,
  promoDescription: null,
  ticketPrice: 1250,
  ticketCurrency: 'lei',
  ticketSalesEndAt: '2027-10-01T18:00:00Z',
  ticketSalesOpen: true,
};

const PAYMENT: PaymentInstructions = {
  beneficiary: 'SRL Flirt Events',
  iban: 'MD24AG000000022512345678',
  bankName: 'maib',
  amount: 2500,
  currency: 'lei',
  reference: '482719',
  commentTemplate: '482719',
  instructions: null,
};

const REQUEST: TicketRequest = {
  id: 'r1',
  event_id: 'e1',
  event_title: 'Flirt Party #7',
  event_starts_at: '2027-10-01T20:00:00Z',
  ticket_quantity: 2,
  ticket_price: 1250,
  total_amount: 2500,
  currency: 'lei',
  full_name: 'Ana Popescu',
  phone: '+37369000000',
  status: 'pending_payment',
  payment: { payment_description: '482719' },
  created_at: '2026-09-25T10:00:00Z',
  updated_at: '2026-09-25T10:00:00Z',
};

function codedError(status: number, code?: string) {
  return Object.assign(new Error(String(status)), { response: { status, data: { detail: '…', code } } });
}

function renderScreen() {
  return renderWithProviders(
    <MemoryRouter initialEntries={[ticketRequestPath('e1')]}>
      <Routes>
        <Route path={TICKET_REQUEST_ROUTE_PATTERN} element={<TicketRequestScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchEvent).mockResolvedValue(EVENT);
  vi.mocked(fetchMyTicketRequests).mockResolvedValue([]);
  vi.mocked(fetchTicketOrder).mockResolvedValue({
    order: { id: 'r1', eventId: 'e1', status: 'pending_payment', price: 1250, currency: 'lei', ticketCode: null },
    payment: PAYMENT,
  });
});

describe('cererile existente', () => {
  it('după o reîncărcare, datele bancare complete se aduc din nou (nu doar codul de plată)', async () => {
    vi.mocked(fetchMyTicketRequests).mockResolvedValue([REQUEST]);
    renderScreen();

    const card = await screen.findByTestId('ticket-request-r1');
    expect(within(card).getByTestId('request-status')).toHaveTextContent('Așteaptă plata');
    expect(within(card).getByTestId('request-next-step')).toHaveTextContent('Plătește și încarcă chitanța');
    expect(await within(card).findByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
    expect(fetchTicketOrder).toHaveBeenCalledWith('r1');
    // Suma, cu separatorul de mii al limbii: „2.500 lei".
    expect(card).toHaveTextContent(/2[.\s ]500 lei/);
    expect(within(card).getByTestId('proof-upload')).toBeInTheDocument();
    // O cerere activă: fără formular nou.
    expect(screen.queryByTestId('request-form')).not.toBeInTheDocument();
  });

  it('după o cerere anulată se poate cere din nou', async () => {
    vi.mocked(fetchMyTicketRequests).mockResolvedValue([{ ...REQUEST, status: 'cancelled' }]);
    renderScreen();

    expect(await screen.findByTestId('request-status')).toHaveTextContent('Comandă anulată');
    expect(screen.queryByTestId('request-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('request-another-btn'));
    expect(screen.getByTestId('request-form')).toBeInTheDocument();
  });
});

describe('formularul', () => {
  it('cantitatea se schimbă cu −/+ și totalul se recalculează, formatat', async () => {
    renderScreen();

    const total = await screen.findByTestId('request-total');
    expect(total).toHaveTextContent(/1[.\s ]250 lei/);
    expect(screen.getByTestId('request-qty-minus')).toBeDisabled();
    fireEvent.click(screen.getByTestId('request-qty-plus'));
    expect(screen.getByTestId('request-qty')).toHaveValue(2);
    expect(total).toHaveTextContent(/2[.\s ]500 lei/);
  });

  it('validează numele și telefonul înainte de trimitere', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('request-submit'));

    expect(await screen.findByText('Introdu numele complet.')).toBeInTheDocument();
    expect(screen.getByText('Introdu un număr de telefon valid.')).toBeInTheDocument();
    expect(createTicketRequest).not.toHaveBeenCalled();
  });

  it('prea puține bilete rămase (409): spune asta, nu „verifică datele"', async () => {
    vi.mocked(createTicketRequest).mockRejectedValue(codedError(409));
    renderScreen();

    fireEvent.change(await screen.findByRole('textbox', { name: /Nume complet/ }), { target: { value: 'Ana Popescu' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Telefon/ }), { target: { value: '069 123 456' } });
    fireEvent.click(screen.getByTestId('request-submit'));

    expect(await screen.findByTestId('request-sold-out')).toHaveTextContent('Nu mai sunt destule bilete disponibile');
    expect(screen.queryByText(/Verifică datele/)).not.toBeInTheDocument();
  });

  it('vânzarea închisă de server (`ticket_sales_closed`) înlocuiește formularul', async () => {
    vi.mocked(createTicketRequest).mockRejectedValue(codedError(409, 'ticket_sales_closed'));
    renderScreen();

    fireEvent.change(await screen.findByRole('textbox', { name: /Nume complet/ }), { target: { value: 'Ana Popescu' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Telefon/ }), { target: { value: '069123456' } });
    fireEvent.click(screen.getByTestId('request-submit'));

    expect(await screen.findByTestId('request-sales-closed')).toHaveTextContent('tocmai s-a închis');
    await waitFor(() => expect(screen.queryByTestId('request-form')).not.toBeInTheDocument());
  });

  it('bilete epuizate (serverul închide înainte de ora anunțată): fără formular', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({ ...EVENT, ticketSalesOpen: false });
    renderScreen();

    expect(await screen.findByTestId('request-sales-closed')).toHaveTextContent('Biletele online s-au epuizat');
    expect(screen.queryByTestId('request-form')).not.toBeInTheDocument();
  });
});
