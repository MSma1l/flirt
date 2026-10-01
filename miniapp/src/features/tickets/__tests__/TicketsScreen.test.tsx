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
  uploadOrderProof: vi.fn(),
  fetchEvent: vi.fn(),
}));

const {
  createTicketOrder,
  fetchEvent,
  fetchMyTicketOrdersWithEvent,
  fetchMyTicketRequests,
  fetchTicket,
  fetchTicketOrder,
  uploadOrderProof,
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
  reference: '482719',
  commentTemplate: '482719',
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
    reference: '482719',
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
    reference: '482719',
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
  reference: '482719',
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
  it('arată suma, codul de plată, IBAN-ul, termenul și pașii', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-o1'));

    await screen.findByTestId('order-instructions');
    const detail = screen.getByTestId('order-detail');
    expect(within(detail).getByTestId('pay-amount')).toHaveTextContent('200 lei');
    expect(within(detail).getByTestId('pay-code')).toHaveTextContent('482719');
    expect(within(detail).getByTestId('pay-code-hint')).toHaveTextContent(
      'Scrie acest cod în comentariul transferului — după el îți găsim plata.',
    );
    // Codul apare O SINGURĂ dată ca bloc (comentariul și referința sunt același lucru).
    expect(within(detail).getAllByTestId('pay-code-block')).toHaveLength(1);
    expect(within(detail).getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
    const steps = within(within(detail).getByTestId('pay-steps')).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent('Deschide aplicația mobilă a băncii tale.');
    expect(steps[0]).not.toHaveTextContent('ghișeu');
    expect(steps[1]).toHaveTextContent('Fă un transfer pe IBAN-ul de mai sus, suma exactă — 200 lei.');
    expect(steps[2]).toHaveTextContent('În comentariul transferului scrie doar codul tău de plată: 482719');
    expect(within(steps[2]!).getByTestId('pay-step-code')).toHaveTextContent('482719');
    expect(steps[3]).toHaveTextContent('Revino aici și încarcă chitanța');
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

      // Codul se copiază exact: doar cifrele, fără spații.
      fireEvent.click(screen.getByTestId('copy-code'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('482719'));

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

  it('cere chitanța în loc de „Am plătit": upload cu progres, apoi „În verificare"', async () => {
    vi.mocked(uploadOrderProof).mockImplementation(async (_id, _file, options) => {
      options?.onProgress?.(60);
      return DECLARED_DETAIL.order;
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    expect(await screen.findByTestId('proof-upload')).toBeInTheDocument();
    expect(screen.queryByTestId('declare-btn')).not.toBeInTheDocument();
    // Fără fișier ales, trimiterea e blocată.
    expect(screen.getByTestId('proof-submit')).toBeDisabled();

    const file = new File(['%PDF-1.4'], 'chitanta.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [file] } });
    expect(await screen.findByTestId('proof-preview')).toHaveTextContent('chitanta.pdf');

    vi.mocked(fetchTicketOrder).mockResolvedValue({
      ...DECLARED_DETAIL,
      order: { ...DECLARED_DETAIL.order, paymentProofUploaded: true },
    });
    fireEvent.click(screen.getByTestId('proof-submit'));

    await waitFor(() =>
      expect(uploadOrderProof).toHaveBeenCalledWith('o1', file, expect.objectContaining({ method: null })),
    );
    expect(await screen.findByTestId('order-in-review')).toHaveTextContent('Am primit dovada plății');
    expect(screen.queryByTestId('order-instructions')).not.toBeInTheDocument();
  });

  it('upload-ul eșuat lasă datele de plată pe ecran și scrie eroarea în pagină', async () => {
    vi.mocked(uploadOrderProof).mockRejectedValue(new Error('500'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    const file = new File(['img'], 'chitanta.png', { type: 'image/png' });
    fireEvent.change(await screen.findByTestId('proof-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('proof-submit'));

    expect(await screen.findByTestId('proof-error')).toBeInTheDocument();
    expect(screen.getByTestId('order-instructions')).toBeInTheDocument();
    expect(screen.getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
  });

  it('după începerea evenimentului, refuzul `event_started` se explică', async () => {
    vi.mocked(uploadOrderProof).mockRejectedValue(codedError(409, 'event_started'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    const file = new File(['img'], 'chitanta.png', { type: 'image/png' });
    fireEvent.change(await screen.findByTestId('proof-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('proof-submit'));

    expect(await screen.findByTestId('proof-error')).toHaveTextContent('Evenimentul a început');
  });
});

describe('plata prin MIA (după numărul de telefon)', () => {
  const MIA_PAYMENT: PaymentInstructions = {
    ...PAYMENT,
    miaPhone: '+37369123456',
    miaRecipientName: 'Ion Popescu',
    methods: ['mia', 'iban'],
  };

  it('arată întâi cardul MIA, cu telefon, destinatar, sumă, codul de plată și 4 pași', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue({ ...AWAITING_DETAIL, payment: MIA_PAYMENT });
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-o1'));

    const mia = await screen.findByTestId('pay-mia');
    expect(within(mia).getByTestId('mia-phone')).toHaveTextContent('+373 69 123 456');
    expect(within(mia).getByTestId('mia-recipient')).toHaveTextContent('Ion Popescu');
    expect(within(mia).getByTestId('mia-amount')).toHaveTextContent('200');
    expect(within(mia).getByTestId('pay-code')).toHaveTextContent('482719');
    expect(within(mia).getAllByTestId('pay-code-block')).toHaveLength(1);
    const steps = within(within(mia).getByTestId('pay-steps')).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent('Deschide aplicația mobilă a băncii tale.');
    expect(steps[1]).toHaveTextContent('Fă un transfer MIA la numărul +373 69 123 456, suma exactă — 200 lei.');
    expect(steps[2]).toHaveTextContent('scrie doar codul tău de plată: 482719');
    expect(screen.getByTestId('pay-method-mia')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('pay-iban')).not.toBeInTheDocument();
  });

  it('telefonul se copiază în forma brută', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      vi.mocked(fetchTicketOrder).mockResolvedValue({ ...AWAITING_DETAIL, payment: MIA_PAYMENT });
      renderScreen();
      fireEvent.click(await screen.findByTestId('order-row-o1'));
      fireEvent.click(await screen.findByTestId('copy-mia-phone'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('+37369123456'));
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('comutatorul trece la IBAN ca alternativă, iar chitanța poartă metoda aleasă', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue({ ...AWAITING_DETAIL, payment: MIA_PAYMENT });
    vi.mocked(uploadOrderProof).mockResolvedValue(DECLARED_DETAIL.order);
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-o1'));

    fireEvent.click(await screen.findByTestId('pay-method-iban'));
    expect(await screen.findByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
    expect(screen.getByText('Alternativă: transfer bancar (IBAN)')).toBeInTheDocument();
    expect(screen.queryByTestId('pay-mia')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pay-method-mia'));
    const file = new File(['img'], 'chitanta.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('proof-submit'));
    await waitFor(() =>
      expect(uploadOrderProof).toHaveBeenCalledWith('o1', file, expect.objectContaining({ method: 'mia' })),
    );
  });

  it('QR-ul MIA apare mare, pe placă albă, și se poate deschide la mărime completă', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(fetchTicketOrder).mockResolvedValue({
      ...AWAITING_DETAIL,
      payment: {
        ...MIA_PAYMENT,
        miaPhone: null,
        miaQrUrl: 'https://media.flrt.md/photos/payment-qr/a.png',
        methods: ['mia'],
      },
    });
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-o1'));

    const qr = await screen.findByTestId('mia-qr');
    expect(within(qr).getByRole('img')).toHaveAttribute('src', 'https://media.flrt.md/photos/payment-qr/a.png');
    expect(qr).toHaveTextContent('Scanează cu aplicația băncii (MIA)');
    // Doar QR: fără telefon de copiat.
    expect(screen.queryByTestId('mia-phone')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('pay-steps')).getAllByRole('listitem')[1]).toHaveTextContent(
      'Fă un transfer MIA: scanează codul QR de mai sus și introdu suma exactă — 200 lei.',
    );

    fireEvent.click(screen.getByTestId('mia-qr-open'));
    expect(open).toHaveBeenCalledWith('https://media.flrt.md/photos/payment-qr/a.png', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('doar MIA configurat: fără comutator și fără IBAN', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue({
      ...AWAITING_DETAIL,
      payment: { ...MIA_PAYMENT, iban: '', beneficiary: '', methods: ['mia'] },
    });
    renderScreen();
    fireEvent.click(await screen.findByTestId('order-row-o1'));
    expect(await screen.findByTestId('pay-mia')).toBeInTheDocument();
    expect(screen.queryByTestId('pay-method-iban')).not.toBeInTheDocument();
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
    // Text vechi de destinație (nu un cod): se arată ca text, cu pasul „lipește textul".
    expect(screen.getByTestId('pay-code')).toHaveTextContent('Ana Popescu');
    expect(screen.getByTestId('pay-steps')).toHaveTextContent('lipește textul de mai sus');
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

    await waitFor(() =>
      expect(uploadPaymentProof).toHaveBeenCalledWith('r1', file, expect.objectContaining({ method: null })),
    );
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
