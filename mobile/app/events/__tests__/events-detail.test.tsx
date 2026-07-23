import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import EventDetailScreen from '../[id]';
import { ThemeProvider } from '@theme/index';
import type { EventItem, PassportStamp } from '@/features/events/types';

// Mock router + parametru de rută.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'e1' }),
  useRouter: () => ({ back: mockBack, push: mockPush, replace: jest.fn() }),
}));

// Mock la eventsApi: fetch controlat + spionăm setGoing / checkin.
const event: EventItem = {
  id: 'e1',
  title: 'Flirt Party Chișinău',
  description: 'Petrecere de neuitat',
  startsAt: '2026-08-01T20:00:00Z',
  city: 'Chișinău',
  venue: 'Club X',
  kind: 'flirt_party',
  attendeeCount: 42,
  iAmGoing: false,
  promoDiscountPercent: null,
  promoCode: null,
  promoDescription: null,
  ticketPrice: null,
  ticketCurrency: null,
};
const stamp: PassportStamp = {
  eventId: 'e1',
  eventTitle: 'Flirt Party Chișinău',
  city: 'Chișinău',
  stampedAt: '2026-08-01T21:00:00Z',
};
const mockFetchEvent = jest.fn<Promise<EventItem>, []>(() => Promise.resolve(event));
const mockSetGoing = jest.fn((_id: string, _going: boolean) => Promise.resolve(event));
const mockCheckin = jest.fn((_id: string) => Promise.resolve(stamp));
jest.mock('@/features/events/eventsApi', () => ({
  fetchEvent: () => mockFetchEvent(),
  setGoing: (id: string, going: boolean) => mockSetGoing(id, going),
  checkin: (id: string) => mockCheckin(id),
}));

// Mock la tickets API: fără comenzi implicit; spionăm crearea comenzii.
const mockFetchMyTicketOrders = jest.fn(() => Promise.resolve([] as unknown[]));
const mockCreateTicketOrder = jest.fn((_eventId: string) =>
  Promise.resolve({ order: { id: 'o1' } }),
);
const mockPush = jest.fn();
jest.mock('@/features/tickets/ticketsApi', () => ({
  fetchMyTicketOrders: () => mockFetchMyTicketOrders(),
  createTicketOrder: (eventId: string) => mockCreateTicketOrder(eventId),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <EventDetailScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('EventDetailScreen', () => {
  beforeEach(() => {
    mockFetchEvent.mockReset();
    mockFetchEvent.mockResolvedValue(event);
    mockSetGoing.mockReset();
    mockSetGoing.mockResolvedValue(event);
    mockCheckin.mockReset();
    mockCheckin.mockResolvedValue(stamp);
    mockBack.mockClear();
    mockFetchMyTicketOrders.mockReset();
    mockFetchMyTicketOrders.mockResolvedValue([]);
    mockCreateTicketOrder.mockReset();
    mockCreateTicketOrder.mockResolvedValue({ order: { id: 'o1' } });
    mockPush.mockClear();
  });

  it('randează detaliile evenimentului', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Flirt Party Chișinău'));
    expect(getByText('Club X · Chișinău')).toBeTruthy();
    expect(getByText('42 participanți')).toBeTruthy();
  });

  it('„Merg" apelează setGoing', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Merg'));
    fireEvent.press(getByText('Merg'));

    await waitFor(() => expect(mockSetGoing).toHaveBeenCalledWith('e1', true));
  });

  it('„Check-in" apelează checkin și arată mesajul de ștampilă', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Check-in (QR)'));
    fireEvent.press(getByText('Check-in (QR)'));

    await waitFor(() => expect(mockCheckin).toHaveBeenCalledWith('e1'));
    await waitFor(() => getByText('Ai primit o ștampilă Flirt Passport 🎉'));
  });

  it('afișează cardul de promo cu procent, cod și descriere când există', async () => {
    mockFetchEvent.mockResolvedValue({
      ...event,
      promoDiscountPercent: 20,
      promoCode: 'FLIRT20',
      promoDescription: 'Valabil la intrare până la ora 22:00.',
    });
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('event-promo'));
    expect(getByTestId('event-promo-code')).toHaveTextContent('FLIRT20');
    expect(getByText('Reducere la intrare −20%')).toBeTruthy();
    expect(getByText('Valabil la intrare până la ora 22:00.')).toBeTruthy();
  });

  it('nu afișează cardul de promo când promo lipsește', async () => {
    mockFetchEvent.mockResolvedValue(event);
    const { getByText, queryByTestId } = renderScreen();

    await waitFor(() => getByText('Flirt Party Chișinău'));
    expect(queryByTestId('event-promo')).toBeNull();
  });

  it('arată butonul de cumpărare bilet când evenimentul are preț', async () => {
    mockFetchEvent.mockResolvedValue({ ...event, ticketPrice: 150, ticketCurrency: 'lei' });
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Cumpără bilet online — 150 lei'));
  });

  it('cumpărarea creează comanda și navighează la ecranul comenzii', async () => {
    mockFetchEvent.mockResolvedValue({ ...event, ticketPrice: 150, ticketCurrency: 'lei' });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('buy-ticket-btn'));
    fireEvent.press(getByTestId('buy-ticket-btn'));

    await waitFor(() => expect(mockCreateTicketOrder).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/tickets/o1'));
  });

  it('arată starea comenzii existente în locul butonului de cumpărare', async () => {
    mockFetchEvent.mockResolvedValue({ ...event, ticketPrice: 150, ticketCurrency: 'lei' });
    mockFetchMyTicketOrders.mockResolvedValue([
      { id: 'o9', eventId: 'e1', status: 'payment_declared', price: 150, currency: 'lei', ticketCode: null },
    ]);
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('ticket-status'));
    expect(queryByTestId('buy-ticket-btn')).toBeNull();
  });

  it('eroarea la check-in afișează un Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCheckin.mockRejectedValueOnce(new Error('boom'));
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Check-in (QR)'));
    fireEvent.press(getByText('Check-in (QR)'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Check-in eșuat', expect.any(String)));
    alertSpy.mockRestore();
  });
});
