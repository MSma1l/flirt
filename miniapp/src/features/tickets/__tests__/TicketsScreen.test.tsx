/**
 * Ecranul de bilete: biletul propriu + comenzile de bilete la evenimente.
 *
 * Rețeaua e tăiată la nivelul modulului local `ticketsApi` (care re-exportă
 * funcțiile pure din aplicația Expo), ca testele să verifice DECIZIILE
 * ecranului — ce se afișează, ce se cheamă, ce rămâne pe ecran la eroare — nu
 * axios.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/harness';

import { EVENTS_PATH } from '@/features/events/eventRoutes';

import { TicketsScreen } from '../TicketsScreen';
import type {
  PaymentInstructions,
  Ticket,
  TicketOrderDetail,
  TicketOrderListItem,
} from '../ticketsApi';

vi.mock('../ticketsApi', () => ({
  fetchTicket: vi.fn(),
  fetchMyTicketOrdersWithEvent: vi.fn(),
  fetchTicketOrder: vi.fn(),
  declareTicketPayment: vi.fn(),
  createTicketOrder: vi.fn(),
}));

const {
  createTicketOrder,
  declareTicketPayment,
  fetchMyTicketOrdersWithEvent,
  fetchTicket,
  fetchTicketOrder,
} = await import('../ticketsApi');

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
  order: {
    id: 'o1',
    eventId: 'e1',
    status: 'awaiting_payment',
    price: 200,
    currency: 'lei',
    ticketCode: null,
  },
  payment: PAYMENT,
};

const DECLARED_DETAIL: TicketOrderDetail = {
  order: { ...AWAITING_DETAIL.order, status: 'payment_declared' },
  payment: null,
};

const APPROVED_DETAIL: TicketOrderDetail = {
  order: {
    id: 'o2',
    eventId: 'e2',
    status: 'approved',
    price: 350,
    currency: 'lei',
    ticketCode: 'ZQ71KM44',
  },
  payment: null,
};

const REJECTED_DETAIL: TicketOrderDetail = {
  order: { ...AWAITING_DETAIL.order, status: 'rejected' },
  payment: null,
};

function renderScreen() {
  return renderWithProviders(
    <MemoryRouter>
      <TicketsScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchTicket).mockResolvedValue(TICKET);
  vi.mocked(fetchMyTicketOrdersWithEvent).mockResolvedValue(ORDERS);
  vi.mocked(fetchTicketOrder).mockResolvedValue(AWAITING_DETAIL);
});

describe('biletul propriu Flirt Party', () => {
  it('arată codul ca QR, ca text și cu starea lui', async () => {
    renderScreen();

    const qr = await screen.findByTestId('ticket-qr');
    // Codul e rupt în grupuri de 4, ca pe mobil.
    expect(qr).toHaveTextContent('FLIR T9Q2 X');
    expect(within(qr).getByRole('img')).toHaveAccessibleName(/FLIRT9Q2X/);
    expect(screen.getByTestId('ticket-status')).toHaveTextContent('NEFOLOSIT');
  });

  it('un bilet deja folosit se vede ca atare', async () => {
    vi.mocked(fetchTicket).mockResolvedValue({ code: 'FLIRT9Q2X', used: true });
    renderScreen();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent(/^FOLOSIT$/);
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchTicket).mockRejectedValueOnce(new Error('offline'));
    renderScreen();

    expect(await screen.findByTestId('ticket-error')).toHaveTextContent(
      'Nu am putut încărca biletul.',
    );

    fireEvent.click(within(screen.getByTestId('ticket-error')).getByRole('button'));

    expect(await screen.findByTestId('ticket-qr')).toBeInTheDocument();
  });
});

describe('lista de comenzi', () => {
  it('cât timp se încarcă, arată indicatori, nu un ecran gol', () => {
    vi.mocked(fetchTicket).mockReturnValue(new Promise<Ticket>(() => {}));
    vi.mocked(fetchMyTicketOrdersWithEvent).mockReturnValue(
      new Promise<TicketOrderListItem[]>(() => {}),
    );
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

  it('arată titlul evenimentului și starea fiecărei comenzi', async () => {
    renderScreen();

    expect(await screen.findByTestId('order-row-o1')).toHaveTextContent(
      'Bilet: finalizează plata',
    );
    expect(screen.getByTestId('order-row-o2')).toHaveTextContent('Bilet aprobat');
    expect(screen.getByTestId('order-row-o2')).toHaveTextContent('Concert în parc');
  });
});

describe('comandă în așteptarea plății', () => {
  it('deschiderea rândului arată IBAN-ul și comentariul exact al transferului', async () => {
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));

    // Panoul apare imediat, dar cu spinner: așteptăm CONȚINUTUL, nu cutia.
    await screen.findByTestId('order-instructions');
    const detail = screen.getByTestId('order-detail');
    expect(within(detail).getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
    expect(within(detail).getByTestId('pay-comment')).toHaveTextContent(
      PAYMENT.commentTemplate,
    );
    expect(within(detail).getByTestId('pay-amount')).toHaveTextContent('200 lei');
    // Pașii 1–4 din instrucțiuni.
    expect(within(detail).getAllByRole('listitem')).toHaveLength(4);
    expect(fetchTicketOrder).toHaveBeenCalledWith('o1');
  });

  it('„Am făcut transferul" cere confirmare, apoi declară plata și actualizează starea', async () => {
    vi.mocked(declareTicketPayment).mockResolvedValue(DECLARED_DETAIL.order);
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('declare-btn'));

    // Confirmarea e o fereastră proprie, nu `confirm()`.
    expect(await screen.findByTestId('declare-confirm')).toBeInTheDocument();
    expect(declareTicketPayment).not.toHaveBeenCalled();

    // După confirmare, comanda se reinterogează și trebuie să fie „în verificare".
    vi.mocked(fetchTicketOrder).mockResolvedValue(DECLARED_DETAIL);
    fireEvent.click(screen.getByTestId('declare-confirm-accept'));

    await waitFor(() => expect(declareTicketPayment).toHaveBeenCalledWith('o1'));
    expect(await screen.findByTestId('order-in-review')).toHaveTextContent('În verificare');
    expect(screen.queryByTestId('order-instructions')).not.toBeInTheDocument();
  });

  it('declararea eșuată lasă instrucțiunile pe ecran și scrie eroarea în pagină', async () => {
    vi.mocked(declareTicketPayment).mockRejectedValue(new Error('500'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('declare-btn'));
    fireEvent.click(await screen.findByTestId('declare-confirm-accept'));

    expect(
      await screen.findByText('Nu am putut înregistra transferul. Reîncearcă.'),
    ).toBeInTheDocument();
    // Instrucțiunile RĂMÂN: omul trebuie să poată reîncerca fără să redeschidă.
    expect(screen.getByTestId('order-instructions')).toBeInTheDocument();
    expect(screen.getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
  });

  it('copierea nu cade când WebView-ul nu dă acces la clipboard', async () => {
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    const copyBtn = await screen.findByTestId('copy-iban');

    expect(() => fireEvent.click(copyBtn)).not.toThrow();
    // Valoarea rămâne pe ecran, selectabilă — copierea nu e o fundătură.
    expect(screen.getByTestId('pay-iban')).toHaveTextContent(PAYMENT.iban);
  });
});

describe('comandă aprobată și comandă respinsă', () => {
  it('comanda aprobată arată QR-ul codului de bilet', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue(APPROVED_DETAIL);
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o2'));

    await screen.findByTestId('order-approved');
    const detail = screen.getByTestId('order-detail');
    expect(within(detail).getByTestId('order-approved')).toHaveTextContent('Biletul tău');

    const qr = within(detail).getByTestId('ticket-qr');
    expect(within(qr).getByRole('img')).toHaveAccessibleName(/ZQ71KM44/);
    expect(qr).toHaveTextContent('ZQ71 KM44');
  });

  it('comanda respinsă poate fi reîncercată cu o comandă nouă pe același eveniment', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue(REJECTED_DETAIL);
    vi.mocked(createTicketOrder).mockResolvedValue({
      order: { ...AWAITING_DETAIL.order, id: 'o3' },
      payment: PAYMENT,
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('order-retry-btn'));

    await waitFor(() => expect(createTicketOrder).toHaveBeenCalledWith('e1'));
  });

  it('eșecul reîncercării se scrie în pagină, nu într-un alert', async () => {
    vi.mocked(fetchTicketOrder).mockResolvedValue(REJECTED_DETAIL);
    vi.mocked(createTicketOrder).mockRejectedValue(new Error('500'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('order-row-o1'));
    fireEvent.click(await screen.findByTestId('order-retry-btn'));

    expect(
      await screen.findByText('Nu am putut crea o comandă nouă. Reîncearcă.'),
    ).toBeInTheDocument();
  });
});
