import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import AnketeScreen from '../ankete';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
// Prefixul `mock` e necesar ca jest să permită referința în factory-ul hoistat.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

// Mock la feedApi: controlăm feed-ul și spionăm swipe.
type SwipeMockResult = { matched: boolean; matchId?: string; chatId?: string | null };
const mockSwipe = jest.fn(
  (_targetUserId: string, _action: string): Promise<SwipeMockResult> =>
    Promise.resolve({ matched: false }),
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
    mockPush.mockClear();
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

  it('la match, „Scrie un mesaj" navighează la chatul creat', async () => {
    mockSwipe.mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('swipe-like'));
    fireEvent.press(getByTestId('swipe-like'));

    // Modalul de match apare; apăsăm „Scrie un mesaj".
    await waitFor(() => getByTestId('match-write'));
    fireEvent.press(getByTestId('match-write'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/chat/c1');
    });
  });

  it('când deck-ul se epuizează, oferă buton de reîncărcare', async () => {
    // Feed cu un singur card; după like devine gol.
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('swipe-like'));
    fireEvent.press(getByTestId('swipe-like'));

    // Starea goală expune butonul de reîncărcare.
    await waitFor(() => getByTestId('deck-reload'));
    fireEvent.press(getByTestId('deck-reload'));

    // Refetch reia încărcarea feed-ului.
    await waitFor(() => {
      expect(mockFetchFeed).toHaveBeenCalledTimes(2);
    });
  });
});
