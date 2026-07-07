import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import PassportScreen from '../passport';
import { ThemeProvider } from '@theme/index';
import type { PassportStamp } from '@/features/events/types';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la eventsApi: grid de ștampile controlat.
const mockFetchPassport = jest.fn<Promise<PassportStamp[]>, []>(() => Promise.resolve([]));
jest.mock('@/features/events/eventsApi', () => ({
  fetchPassport: () => mockFetchPassport(),
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
});
