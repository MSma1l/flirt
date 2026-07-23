import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import TicketOrderScreen from '../[id]';
import { ThemeProvider } from '@theme/index';
import type { TicketOrderDetail } from '@/features/tickets/types';

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'o1' }),
  useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }),
}));

const mockFetchTicketOrder = jest.fn<Promise<TicketOrderDetail>, []>();
const mockDeclare = jest.fn((_id: string) =>
  Promise.resolve({ id: 'o1', eventId: 'e1', status: 'payment_declared', price: null, currency: null, ticketCode: null }),
);
const mockCreate = jest.fn((_eventId: string) => Promise.resolve({ order: { id: 'o2' } }));
jest.mock('@/features/tickets/ticketsApi', () => ({
  fetchTicketOrder: () => mockFetchTicketOrder(),
  declareTicketPayment: (id: string) => mockDeclare(id),
  createTicketOrder: (eventId: string) => mockCreate(eventId),
}));

const awaiting: TicketOrderDetail = {
  order: { id: 'o1', eventId: 'e1', status: 'awaiting_payment', price: 150, currency: 'lei', ticketCode: null },
  payment: {
    beneficiary: 'Flirt SRL',
    iban: 'MD24AG000000000000000000',
    bankName: 'MAIB',
    amount: 150,
    currency: 'lei',
    reference: 'ACC-42',
    commentTemplate: 'FLIRT o1 ACC-42',
    instructions: null,
  },
};

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TicketOrderScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TicketOrderScreen', () => {
  beforeEach(() => {
    mockFetchTicketOrder.mockReset();
    mockFetchTicketOrder.mockResolvedValue(awaiting);
    mockDeclare.mockClear();
    mockCreate.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
  });

  it('awaiting_payment: afișează instrucțiunile de plată și comentariul', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('order-instructions'));
    expect(getByTestId('pay-amount')).toHaveTextContent('150 lei');
    expect(getByTestId('pay-comment')).toHaveTextContent('FLIRT o1 ACC-42');
  });

  it('„Am făcut transferul" declară plata', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('declare-btn'));
    fireEvent.press(getByTestId('declare-btn'));

    await waitFor(() => expect(mockDeclare).toHaveBeenCalledWith('o1'));
  });

  it('payment_declared: mesaj „în verificare"', async () => {
    mockFetchTicketOrder.mockResolvedValue({
      order: { ...awaiting.order, status: 'payment_declared' },
      payment: null,
    });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('order-in-review'));
  });

  it('approved: afișează QR-ul biletului cu codul', async () => {
    mockFetchTicketOrder.mockResolvedValue({
      order: { ...awaiting.order, status: 'approved', ticketCode: 'TCK-777' },
      payment: null,
    });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('order-approved'));
    expect(getByTestId('qr-value')).toHaveTextContent('TCK-777');
  });

  it('rejected: permite reîncercarea creând o comandă nouă', async () => {
    mockFetchTicketOrder.mockResolvedValue({
      order: { ...awaiting.order, status: 'rejected' },
      payment: null,
    });
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('order-rejected'));
    fireEvent.press(getByText('Încearcă din nou'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tickets/o2'));
  });
});
