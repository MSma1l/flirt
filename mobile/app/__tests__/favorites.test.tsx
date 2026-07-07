import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import FavoritesScreen from '../favorites';
import { ThemeProvider } from '@theme/index';
import type { FavoriteItem } from '@/features/social/socialApi';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la socialApi: listă controlată + spionăm eliminarea.
const mockFetchFavorites = jest.fn<Promise<FavoriteItem[]>, []>(() => Promise.resolve([]));
const mockRemoveFavorite = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/features/social/socialApi', () => ({
  fetchFavorites: () => mockFetchFavorites(),
  removeFavorite: (id: string) => mockRemoveFavorite(id),
}));

const favorites: FavoriteItem[] = [
  { targetUserId: 'u1', name: 'Ana', age: 25, city: 'Chișinău' },
  { targetUserId: 'u2', name: 'Maria', age: 28, city: 'Bălți' },
];

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <FavoritesScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('FavoritesScreen', () => {
  beforeEach(() => {
    mockFetchFavorites.mockReset();
    mockRemoveFavorite.mockClear();
  });

  it('randează lista de favorite', async () => {
    mockFetchFavorites.mockResolvedValue(favorites);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ana, 25'));
    expect(getByText('Maria, 28')).toBeTruthy();
  });

  it('afișează starea goală', async () => {
    mockFetchFavorites.mockResolvedValue([]);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Nu ai favorite încă ★'));
  });

  it('eliminarea apelează removeFavorite', async () => {
    mockFetchFavorites.mockResolvedValue(favorites);
    const { getByLabelText } = renderScreen();

    await waitFor(() => getByLabelText('Elimină Ana din favorite'));
    fireEvent.press(getByLabelText('Elimină Ana din favorite'));

    await waitFor(() => expect(mockRemoveFavorite).toHaveBeenCalledWith('u1'));
  });
});
