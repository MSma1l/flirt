import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import PassportScreen from '../passport';
import { ThemeProvider } from '@theme/index';
import type { PassportStamp } from '@/features/events/types';
import type { Subscription } from '@/features/subscription/types';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la eventsApi: grid de ștampile controlat.
const mockFetchPassport = jest.fn<Promise<PassportStamp[]>, []>(() => Promise.resolve([]));
jest.mock('@/features/events/eventsApi', () => ({
  fetchPassport: () => mockFetchPassport(),
}));

// Mock la subscriptionApi: abonamentul curent (pentru contorul „Card reduceri").
const mockFetchMe = jest.fn<Promise<Subscription | null>, []>(() => Promise.resolve(null));
jest.mock('@/features/subscription/subscriptionApi', () => ({
  fetchMySubscription: () => mockFetchMe(),
}));

const stamps: PassportStamp[] = [
  { eventId: 'e1', eventTitle: 'Flirt Party', city: 'Chișinău', stampedAt: '2026-07-01T20:00:00Z' },
  { eventId: 'e2', eventTitle: 'Concert', city: 'Bălți', stampedAt: '2026-07-05T19:00:00Z' },
];

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PassportScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('PassportScreen', () => {
  beforeEach(() => {
    mockFetchPassport.mockReset();
    mockFetchMe.mockReset();
    mockFetchMe.mockResolvedValue(null);
  });

  it('randează gridul de ștampile', async () => {
    mockFetchPassport.mockResolvedValue(stamps);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Flirt Party'));
    expect(getByText('Concert')).toBeTruthy();
  });

  it('afișează starea goală', async () => {
    mockFetchPassport.mockResolvedValue([]);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Încă nu ai ștampile — participă la un eveniment!'));
  });

  it('afișează contorul de intrări când userul are un card de reduceri', async () => {
    mockFetchPassport.mockResolvedValue([]);
    mockFetchMe.mockResolvedValue({
      plan: 'card_5',
      status: 'active',
      expiresAt: '2026-08-01',
      entriesTotal: 5,
      entriesRemaining: 3,
    });
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('passport-discount-card'));
    expect(getByText('3 din 5 intrări rămase')).toBeTruthy();
  });

  it('nu afișează contorul când userul nu are card de reduceri', async () => {
    mockFetchPassport.mockResolvedValue(stamps);
    mockFetchMe.mockResolvedValue({
      plan: 'premium',
      status: 'active',
      expiresAt: '2026-08-01',
      entriesTotal: null,
      entriesRemaining: null,
    });
    const { getByText, queryByTestId } = renderScreen();

    await waitFor(() => getByText('Flirt Party'));
    expect(queryByTestId('passport-discount-card')).toBeNull();
  });
});
