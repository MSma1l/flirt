/**
 * Ecranul de bilete: comenzile (carduri-bilet cu cronologie, plată, dovadă,
 * așteptare, bilet cu QR, refuz) și biletul propriu Flirt Party.
 *
 * Rețeaua e tăiată la nivelul modulului local `ticketsApi`, ca testele să
 * verifice DECIZIILE ecranului — ce se afișează, ce se cheamă, ce rămâne pe
 * ecran la eroare — nu axios.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  TicketOrder as MobileTicketOrder,
  TicketOrderDetail as MobileTicketOrderDetail,
} from '@mobile/features/tickets/types';

import { EVENTS_PATH } from '@/features/events/eventRoutes';
import { renderWithProviders } from '@/test/harness';

import { LIVE_TICKET_POLL_MS, TicketsScreen } from '../TicketsScreen';
import { ticketOrderPath, TICKETS_PATH } from '../ticketRoutes';
import type {
  EventItem,
  PaymentInstructions,
  Ticket,
  TicketOrderDetail,
  TicketOrderListItem,
  TicketRequest,
} from '../ticketsApi';

vi.mock('../ticketsApi', () => ({
  fetchTicket: vi.fn(),
  fetchMyTicketOrdersWithEvent: vi.fn(),
  fetchTicketOrder: vi.fn(),
  declareTicketPayment: vi.fn(),
  createTicketOrder: vi.fn(),
  fetchMyTicketRequests: vi.fn(),
  uploadPaymentProof: vi.fn(),
  fetchEvent: vi.fn(),
}));

const {
  createTicketOrder,
  declareTicketPayment,
  fetchEvent,
  fetchMyTicketOrdersWithEvent,
  fetchMyTicketRequests,
  fetchTicket,
  fetchTicketOrder,
  uploadPaymentProof,
} = await import('../ticketsApi');

/** O eroare axios cu cod stabil, ca de la `CodedHTTPException`. */
function codedError(status: number, code: string) {
  return Object.assign(new Error(code), { response: { status, data: { detail: '…', code } } });
}

const TICKET: Ticket = { code: 'FLIRT9Q2X', used: false };

const PAYMENT: PaymentInstructions = {
  beneficiary: 'SRL Flirt Events',
  iban: 'MD24AG000000022512345678',
  bankName: 'maib',
  amount: 200,
  currency: 'lei',
  reference: 'U-1A2B3C4D',
  commentTemplate: 'Bilet Flirt Party 1 octombrie Ref:U-1A2B3C4D',
  instructions: null,
};

const EVENT: EventItem = {
  id: 'e1',
  title: 'Flirt Party #7',
  description: '',
  startsAt: '2026-10-01T20:00:00Z',
  city: 'Chișinău',
  venue: 'Club Mono',
  kind: 'flirt_party',
  attendeeCount: 10,
  iAmGoing: false,
  promoDiscountPercent: null,
  promoCode: null,
  promoDescription: null,
  ticketPrice: 200,
  ticketCurrency: 'lei',
  ticketSalesEndAt: '2026-10-01T18:00:00Z',
  ticketSalesOpen: true,
};

const ORDERS: TicketOrderListItem[] = [
  {
    id: 'o1',
    eventId: 'e1',
    eventTitle: 'Flirt Party #7',
    eventStartsAt: '2026-10-01T20:00:00Z',
    status: 'awaiting_payment',
    price: 200,
    currency: 'lei',
    reference: 'U-1A2B3C4D',
    ticketCode: null,
    createdAt: '2026-09-20T10:00:00Z',
  },
  {
    id: 'o2',
    eventId: 'e2',
    eventTitle: 'Concert în parc',
    eventStartsAt: '2026-11-05T19:00:00Z',
    status: 'approved',
    price: 350,
    currency: 'lei',
    reference: 'U-1A2B3C4D',
    ticketCode: 'ZQ71KM44',
    createdAt: '2026-09-18T10:00:00Z',
  },
];

const AWAITING_DETAIL: TicketOrderDetail = {
  order: { id: 'o1', eventId: 'e1', status: 'awaiting_payment', price: 200, currency: 'lei', ticketCode: null },
  payment: PAYMENT,
};

const DECLARED_DETAIL: TicketOrderDetail = {
  order: { ...AWAITING_DETAIL.order, status: 'payment_declared' },
  payment: null,
};

const APPROVED_DETAIL: TicketOrderDetail = {
  order: { id: 'o2', eventId: 'e2', status: 'approved', price: 350, currency: 'lei', ticketCode: 'ZQ71KM44' },
  payment: null,
};

const REJECTED_DETAIL: TicketOrderDetail = {
  order: { ...AWAITING_DETAIL.order, status: 'rejected', adminNote: 'Suma transferată e 150 lei, nu 200.' },
  payment: null,
};

/** O cerere manuală (cu dovadă), în așteptarea plății. */
const REQUEST: TicketRequest = {
  id: 'r1',
  event_id: 'e1',
  event_title: 'Flirt Party #7',
  event_starts_at: '2026-10-01T20:00:00Z',
  event_venue: 'Club Mono',
  ticket_quantity: 2,
  ticket_price: 170,
  total_amount: 340,
  currency: 'lei',
  full_name: 'Ana Popescu',
  phone: '+37369000000',
  status: 'pending_payment',
  payment: { payment_description: 'Bilet Flirt Party #7 – 2026-10-01 – Ana Popescu' },
  can_resubmit_proof: false,
  created_at: '2026-09-25T10:00:00Z',
  updated_at: '2026-09-25T10:00:00Z',
};

const REQUEST_ROW: TicketOrderListItem = {
  id: 'r1',
  eventId: 'e1',
  eventTitle: 'Flirt Party #7',
  eventStartsAt: '2026-10-01T20:00:00Z',
  status: 'pending_payment',
  price: 170,
  currency: 'lei',
  reference: 'U-1A2B3C4D',
  ticketCode: null,
  createdAt: '2026-09-25T10:00:00Z',
};

function renderScreen(initialEntry: string = TICKETS_PATH) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TicketsScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(fetchTicket).mockResolvedValue(TICKET);
  vi.mocked(fetchMyTicketOrdersWithEvent).mockResolvedValue(ORDERS);
  vi.mocked(fetchTicketOrder).mockResolvedValue(AWAITING_DETAIL);
  vi.mocked(fetchMyTicketRequests).mockResolvedValue([]);
  vi.mocked(fetchEvent).mockResolvedValue(EVENT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('biletul propriu Flirt Party', () => {
  it('arată QR-ul, codul scurt și, la cerere, codul complet', async () => {
    renderScreen();

    const pass = await screen.findByTestId('my-ticket-pass');
    expect(within(pass).getByRole('img')).toHaveAccessibleName(/FLIRT9Q2X/);
    // Ultimele 8 caractere, grupate: de citit cu ochiul la intrare.
    expect(within(pass).getByTestId('ticket-short-code')).toHaveTextContent('LIRT 9Q2X');
    expect(within(pass).queryByTestId('ticket-full-code')).not.toBeInTheDocument();

    fireEvent.click(within(pass).getByTestId('ticket-code-toggle'));
    expect(within(pass).getByTestId('ticket-full-code')).toHaveTextContent('FLIR T9Q2 X');
    expect(pass).toHaveTextContent('Mărește luminozitatea ecranului la intrare');
  });

  it('pe un server vechi (fără `status`) păstrează afișarea NEFOLOSIT / FOLOSIT', async () => {
    renderScreen();
    expect(await screen.findByTestId('ticket-status')).toHaveTextContent('NEFOLOSIT');
  });

  it('un bilet deja folosit (server vechi) se vede ca atare', async () => {
    vi.mocked(fetchTicket).mockResolvedValue({ code: 'FLIRT9Q2X', used: true });
    renderScreen();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent(/^FOLOSIT$/);
  });

  it('biletul valid se anunță ca valid și e reinterogat cât stă pe ecran', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetchTicket).mockResolvedValue({ ...TICKET, status: 'valid', admittedAt: null });
    renderScreen();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent(
      'Valid · arată-l la intrare',
    );
    const before = vi.mocked(fetchTicket).mock.calls.length;

    // Scanat la intrare între timp: următoarea interogare îl întoarce „admis".
    vi.mocked(fetchTicket).mockResolvedValue({
      ...TICKET,
      status: 'admitted',
      admittedAt: '2026-10-01T20:04:00Z',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_TICKET_POLL_MS + 100);
    });

    await waitFor(() => expect(vi.mocked(fetchTicket).mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByTestId('ticket-status')).toHaveTextContent('INTRARE PERMISĂ');
  });

  it('biletul admis la intrare arată banda verde cu ora', async () => {
    vi.mocked(fetchTicket).mockResolvedValue({
      ...TICKET,
      used: true,
      status: 'admitted',
      admittedAt: '2026-10-01T20:04:00Z',
    });
    renderScreen();

    const status = await screen.findByTestId('ticket-status');
    expect(status).toHaveTextContent(/INTRARE PERMISĂ · \d{1,2}[:.]\d{2}/);
    expect(screen.getByTestId('my-ticket-pass')).toHaveClass('tk-pass--admitted');
  });

  it.each([
    ['used', 'Folosit'],
    ['expired', 'Expirat'],
    ['cancelled', 'Anulat'],
  ] as const)('starea %s se scrie limpede', async (status, label) => {
    vi.mocked(fetchTicket).mockResolvedValue({ ...TICKET, status });
    renderScreen();
    expect(await screen.findByTestId('ticket-status')).toHaveTextContent(label);
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchTicket).mockRejectedValueOnce(new Error('offline'));
    renderScreen();

    expect(await screen.findByTestId('ticket-error')).toHaveTextContent('Nu am putut încărca biletul.');
    fireEvent.click(within(screen.getByTestId('ticket-error')).getByRole('button'));

    expect(await screen.findByTestId('my-ticket-pass')).toBeInTheDocument();
  });
});

describe('lista de comenzi', () => {
  it('cât timp se încarcă, arată indicatori, nu un ecran gol', () => {
    vi.mocked(fetchTicket).mockReturnValue(new Promise<Ticket>(() => {}));
    vi.mocked(fetchMyTicketOrdersWithEvent).mockReturnValue(new Promise<TicketOrderListItem[]>(() => {}));
    renderScreen();

    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('fără comenzi explică de unde se cumpără și duce la evenimente', async () => {
    vi.mocked(fetchMyTicketOrdersWithEvent).mockResolvedValue([]);
    renderScreen();

    const empty = await screen.findByTestId('orders-empty');
    expect(empty).toHaveTextContent('Nu ai nicio comandă de bilet');
    expect(within(empty).getByRole('link')).toHaveAttribute('href', EVENTS_PATH);
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchMyTicketOrdersWithEvent).mockRejectedValueOnce(new Error('offline'));
    renderScreen();

    expect(await screen.findByTestId('orders-error')).toHaveTextContent(
      'Nu am putut încărca comenzile de bilete.',
    );
    fireEvent.click(within(screen.getByTestId('orders-error')).getByRole('button'));

    expect(await screen.findByTestId('order-row-o1')).toHaveTextContent('Flirt Party #7');
  });

  it('arată titlul evenimentului și starea fiecărei comenzi, inclusiv a cererilor manuale', async () => {
    vi.mocked(fetchMyTicketOrdersWithEvent).mockResolvedValue([
      ...ORDERS,
      { ...REQUEST_ROW, id: 'r2', status: 'payment_proof_submitted' },
    ]);
    renderScreen();

    expect(await screen.findByTestId('order-row-o1')).toHaveTextContent('Bilet: finalizează plata');
    expect(screen.getByTestId('order-row-o2')).toHaveTextContent('Bilet aprobat');
    expect(screen.getByTestId('order-row-o2')).toHaveTextContent('Concert în parc');
    expect(screen.getByTestId('order-row-r2')).toHaveTextContent('Dovadă trimisă / În verificare');
  });

  it('`?order=` deschide direct comanda cerută (venind din pagina evenimentului)', async () => {
    renderScreen(ticketOrderPath('o1'));

    expect(await screen.findByTestId('order-instructions')).toBeInTheDocument();
    expect(screen.getByTestId('order-row-o1')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('comandă în așteptarea plății', () => {
  it('arată suma, destinația plății, IBAN-ul, termenul și pașii', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-o1'));

    await screen.findByTestId('order-instructions');
    const detail = screen.getByTestId('order-detail');
    expect(within(detail).getByTestId('pay-amount')).toHaveTextContent('200 lei');
    expect(within(detail).getByTestId('pay-comment')).toHaveTextContent(PAYMENT.commentTemplate);
    expect(within(detail).getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
    expect(within(detail).getByTestId('pay-reference')).toHaveTextContent('U-1A2B3C4D');
    expect(within(within(detail).getByTestId('pay-steps')).getAllByRole('listitem')).toHaveLength(4);
    // Cronologia: comandat, urmează plata.
    expect(within(detail).getByTestId('order-stepper')).toHaveTextContent('Comandat');
    // Termenul = închiderea vânzării online a evenimentului.
    expect(await within(detail).findByTestId('pay-deadline')).toHaveTextContent('Plătește până la');
    expect(fetchTicketOrder).toHaveBeenCalledWith('o1');
  });

  it('fiecare câmp se copiază, cu confirmare vizibilă', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      renderScreen();
      fireEvent.click(await screen.findByTestId('order-row-o1'));

      fireEvent.click(await screen.findByTestId('copy-iban'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(PAYMENT.iban));
      expect(await screen.findByTestId('copy-iban')).toHaveTextContent('Copiat');

      fireEvent.click(screen.getByTestId('copy-comment'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(PAYMENT.commentTemplate));

      fireEvent.click(screen.getByTestId('copy-amount'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('200'));
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copierea nu cade când WebView-ul nu dă acces la clipboard', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-o1'));
    const copyBtn = await screen.findByTestId('copy-iban');

    expect(() => fireEvent.click(copyBtn)).not.toThrow();
    expect(screen.getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
  });

  it('„Am făcut transferul" cere confirmare, apoi declară plata și trece în „În verificare"', async () => {
    vi.mocked(declareTicketPayment).mockResolvedValue(DECLARED_DETAIL.order as MobileTicketOrder);
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('declare-btn'));

    expect(await screen.findByTestId('declare-confirm')).toBeInTheDocument();
    expect(declareTicketPayment).not.toHaveBeenCalled();

    vi.mocked(fetchTicketOrder).mockResolvedValue(DECLARED_DETAIL);
    fireEvent.click(screen.getByTestId('declare-confirm-accept'));

    await waitFor(() => expect(declareTicketPayment).toHaveBeenCalledWith('o1'));
    expect(await screen.findByTestId('order-in-review')).toHaveTextContent('În verificare');
    expect(screen.queryByTestId('order-instructions')).not.toBeInTheDocument();
  });

  it('declararea eșuată lasă datele de plată pe ecran și scrie eroarea în pagină', async () => {
    vi.mocked(declareTicketPayment).mockRejectedValue(new Error('500'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('declare-btn'));
    fireEvent.click(await screen.findByTestId('declare-confirm-accept'));

    expect(await screen.findByText('Nu am putut înregistra transferul. Reîncearcă.')).toBeInTheDocument();
    expect(screen.getByTestId('order-instructions')).toBeInTheDocument();
    expect(screen.getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
  });

  it('după începerea evenimentului, refuzul `event_started` se explică', async () => {
    vi.mocked(declareTicketPayment).mockRejectedValue(codedError(409, 'event_started'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('declare-btn'));
    fireEvent.click(await screen.findByTestId('declare-confirm-accept'));

    expect(
      await screen.findByText('Evenimentul a început — plata nu mai poate fi trimisă online.'),
    ).toBeInTheDocument();
  });
});

describe('cerere manuală cu dovadă de plată', () => {
  beforeEach(() => {
    vi.mocked(fetchMyTicketOrdersWithEvent).mockResolvedValue([REQUEST_ROW]);
    vi.mocked(fetchMyTicketRequests).mockResolvedValue([REQUEST]);
    vi.mocked(fetchTicketOrder).mockResolvedValue({
      order: { id: 'r1', eventId: 'e1', status: 'pending_payment', price: 170, currency: 'lei', ticketCode: null },
      payment: null,
    });
  });

  it('arată suma totală și destinația plății, și cere dovada în loc de „Am plătit"', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-r1'));

    await screen.findByTestId('order-instructions');
    expect(screen.getByTestId('pay-amount')).toHaveTextContent('340 lei');
    expect(screen.getByTestId('pay-comment')).toHaveTextContent('Ana Popescu');
    expect(screen.getByTestId('proof-upload')).toBeInTheDocument();
    expect(screen.queryByTestId('declare-btn')).not.toBeInTheDocument();
  });

  it('dovada încărcată trece comanda în verificare', async () => {
    vi.mocked(uploadPaymentProof).mockResolvedValue({ ...REQUEST, status: 'payment_proof_submitted' });
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-r1'));

    const input = await screen.findByTestId('proof-input');
    const file = new File(['img'], 'chitanta.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    vi.mocked(fetchTicketOrder).mockResolvedValue({
      order: { id: 'r1', eventId: 'e1', status: 'payment_proof_submitted', price: 170, currency: 'lei', ticketCode: null },
      payment: null,
    });
    fireEvent.click(screen.getByTestId('proof-submit'));

    await waitFor(() => expect(uploadPaymentProof).toHaveBeenCalledWith('r1', file));
    expect(await screen.findByTestId('order-in-review')).toHaveTextContent('Am primit dovada plății');
  });
});

describe('comandă aprobată și comandă respinsă', () => {
  it('comanda aprobată se deschide ca bilet cu QR, titular și cod scurt', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue(APPROVED_DETAIL);
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o2'));

    const approved = await screen.findByTestId('order-approved');
    expect(approved).toHaveTextContent('Biletul tău');
    const pass = within(approved).getByTestId('order-ticket-pass');
    expect(within(pass).getByRole('img')).toHaveAccessibleName(/ZQ71KM44/);
    expect(within(pass).getByTestId('ticket-short-code')).toHaveTextContent('ZQ71 KM44');
    expect(pass).toHaveTextContent('Concert în parc');
    // Prima deschidere: animația de „deschidere" a biletului.
    expect(await within(pass).findByTestId('ticket-reveal')).toHaveTextContent('Biletul tău e gata');
  });

  it('animația de deschidere rulează o singură dată per bilet', async () => {
    window.localStorage.setItem('flirt.tickets.revealed', JSON.stringify(['o2']));
    vi.mocked(fetchTicketOrder).mockResolvedValue(APPROVED_DETAIL);
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o2'));
    await screen.findByTestId('order-ticket-pass');
    expect(screen.queryByTestId('ticket-reveal')).not.toBeInTheDocument();
  });

  it('biletul unei comenzi, scanat la intrare, arată „INTRARE PERMISĂ"', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue({
      ...APPROVED_DETAIL,
      order: { ...APPROVED_DETAIL.order, ticketStatus: 'admitted', admittedAt: '2026-11-05T19:10:00Z' },
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o2'));
    expect(await screen.findByTestId('order-ticket-status')).toHaveTextContent('INTRARE PERMISĂ');
  });

  it('comanda respinsă arată motivul și poate fi reîncercată cu o comandă nouă', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue(REJECTED_DETAIL);
    vi.mocked(createTicketOrder).mockResolvedValue({
      order: { ...(AWAITING_DETAIL.order as MobileTicketOrder), id: 'o3' },
      payment: null,
    } satisfies MobileTicketOrderDetail);
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    expect(await screen.findByTestId('order-reject-reason')).toHaveTextContent(
      'Suma transferată e 150 lei, nu 200.',
    );
    fireEvent.click(screen.getByTestId('order-retry-btn'));

    await waitFor(() => expect(createTicketOrder).toHaveBeenCalledWith('e1'));
  });

  it('eșecul reîncercării se scrie în pagină, nu într-un alert', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue(REJECTED_DETAIL);
    vi.mocked(createTicketOrder).mockRejectedValue(new Error('500'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('order-retry-btn'));

    expect(await screen.findByText('Nu am putut crea o comandă nouă. Reîncearcă.')).toBeInTheDocument();
  });

  it('reîncercarea după închiderea vânzării explică de ce nu se mai poate', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue(REJECTED_DETAIL);
    vi.mocked(createTicketOrder).mockRejectedValue(codedError(409, 'ticket_sales_closed'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('order-retry-btn'));

    expect(await screen.findByTestId('order-sales-closed')).toHaveTextContent(
      'Vânzarea online tocmai s-a închis',
    );
    expect(screen.queryByTestId('order-retry-btn')).not.toBeInTheDocument();
  });
});
