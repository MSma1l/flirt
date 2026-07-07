import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { StoriesBar } from '../StoriesBar';
import { UserStories } from '../types';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock la API-ul de stories: controlăm grupurile întoarse.
const mockFetchStories = jest.fn<Promise<UserStories[]>, []>();
jest.mock('../storiesApi', () => ({
  fetchStories: () => mockFetchStories(),
}));

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <StoriesBar />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('StoriesBar', () => {
  beforeEach(() => mockFetchStories.mockReset());

  it('afișează cercul „+" (Adaugă) chiar și fără povești', async () => {
    mockFetchStories.mockResolvedValue([]);
    const { getByText } = renderBar();

    await waitFor(() => expect(getByText('+')).toBeTruthy());
    expect(getByText('Adaugă')).toBeTruthy();
  });

  it('afișează un cerc cu numele unui utilizator care are povești', async () => {
    mockFetchStories.mockResolvedValue([
      {
        userId: 'u1',
        name: 'Ana',
        storyCount: 2,
        stories: [],
      },
    ]);
    const { getByText } = renderBar();

    await waitFor(() => expect(getByText('Ana')).toBeTruthy());
    // Inițiala numelui în cerc.
    expect(getByText('A')).toBeTruthy();
    // Cercul „+" rămâne mereu prezent.
    expect(getByText('Adaugă')).toBeTruthy();
  });
});
