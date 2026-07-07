import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import EventsScreen from '../index';
import { ThemeProvider } from '@theme/index';
import type { EventItem } from '@/features/events/types';

// Mock router (evită navigarea reală expo-router în teste).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

// Mock la eventsApi: controlăm lista de evenimente.
const mockFetchEvents = jest.fn<Promise<EventItem[]>, []>(() => Promise.resolve([]));
jest.mock('@/features/events/eventsApi', () => ({
  fetchEvents: () => mockFetchEvents(),
}));

const events: EventItem[] = [
  {
    id: 'e1',
    title: 'Flirt Party Chișinău',
    description: 'Petrecere',
    startsAt: '2026-08-01T20:00:00Z',
    city: 'Chișinău',
    venue: 'Club X',
    kind: 'flirt_party',
    attendeeCount: 42,
    iAmGoing: false,
  },
  {
    id: 'e2',
    title: 'Concert de vară',
    description: 'Live',
    startsAt: '2026-08-05T19:00:00Z',
    city: 'Bălți',
    venue: 'Arena',
    kind: 'concert',
    attendeeCount: 10,
    iAmGoing: true,
  },
];

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <EventsScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('EventsScreen (listă)', () => {
  beforeEach(() => {
    mockFetchEvents.mockReset();
    mockPush.mockClear();
  });

  it('randează cardurile de evenimente', async () => {
    mockFetchEvents.mockResolvedValue(events);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Flirt Party Chișinău'));
    expect(getByText('Concert de vară')).toBeTruthy();
  });

  it('afișează starea goală când nu există evenimente', async () => {
    mockFetchEvents.mockResolvedValue([]);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Niciun eveniment momentan — revino curând!'));
  });

  it('tap pe card navighează la detaliu', async () => {
    mockFetchEvents.mockResolvedValue(events);
    const { getByLabelText } = renderScreen();

    await waitFor(() => getByLabelText('Deschide Flirt Party Chișinău'));
    fireEvent.press(getByLabelText('Deschide Flirt Party Chișinău'));

    expect(mockPush).toHaveBeenCalledWith('/events/e1');
  });

  it('linkul Flirt Passport navighează la passport', async () => {
    mockFetchEvents.mockResolvedValue(events);
    const { getByLabelText } = renderScreen();

    await waitFor(() => getByLabelText('Deschide Flirt Passport'));
    fireEvent.press(getByLabelText('Deschide Flirt Passport'));

    expect(mockPush).toHaveBeenCalledWith('/passport');
  });
});
