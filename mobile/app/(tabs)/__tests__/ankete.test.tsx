import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import AnketeScreen from '../ankete';
import { ThemeProvider } from '@theme/index';

// Mock la feedApi: controlăm feed-ul și spionăm swipe.
const mockSwipe = jest.fn(
  (_targetUserId: string, _action: string) => Promise.resolve({ matched: false }),
);
const mockFetchFeed = jest.fn(() =>
  Promise.resolve([
    {
      userId: 'u1',
      name: 'Ana',
      age: 24,
      gender: 'female',
      city: 'Chișinău',
      distanceKm: 3,
      about: 'Salut!',
      topInterests: ['sport'],
      languages: ['ro'],
      compatibility: 82,
      photos: [],
    },
  ]),
);

jest.mock('@/features/feed/feedApi', () => ({
  fetchFeed: () => mockFetchFeed(),
  swipe: (targetUserId: string, action: string) => mockSwipe(targetUserId, action),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AnketeScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AnketeScreen', () => {
  beforeEach(() => {
    mockSwipe.mockClear();
    mockFetchFeed.mockClear();
  });

  it('la apăsarea butonului like cheamă swipe cu user_id-ul cardului curent', async () => {
    const { getByTestId } = renderScreen();

    // Așteptăm încărcarea feed-ului (cardul de sus).
    await waitFor(() => getByTestId('swipe-like'));

    fireEvent.press(getByTestId('swipe-like'));

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'like');
    });
  });
});
