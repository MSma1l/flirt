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
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
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
