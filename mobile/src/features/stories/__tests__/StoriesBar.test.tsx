import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { StoriesBar } from '../StoriesBar';
import { UserStories } from '../types';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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
  beforeEach(() => {
    mockFetchStories.mockReset();
    mockPush.mockReset();
  });

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

  it('apăsarea pe „Adaugă" navighează la ecranul de story nou', async () => {
    mockFetchStories.mockResolvedValue([]);
    const { getByLabelText } = renderBar();

    await waitFor(() => expect(getByLabelText('Adaugă story')).toBeTruthy());
    fireEvent.press(getByLabelText('Adaugă story'));
    expect(mockPush).toHaveBeenCalledWith('/stories/new');
  });

  // Cerința 3: „dacă am făcut un story, vreau să îl pot vedea eu, singur".
  // Backendul pune grupul PROPRIU primul în `/stories/` (story_service:114).
  // Bara NU are voie să-l filtreze: trebuie să apară un cerc pentru el, iar
  // apăsarea lui să deschidă vizualizatorul propriu.
  it('afișează și grupul propriu, nu doar al match-urilor', async () => {
    mockFetchStories.mockResolvedValue([
      { userId: 'me', name: 'Ivan', storyCount: 1, stories: [] },
      { userId: 'u1', name: 'Ana', storyCount: 2, stories: [] },
    ]);
    const { getByText, getByLabelText } = renderBar();

    await waitFor(() => expect(getByText('Ivan')).toBeTruthy());
    // Grupul propriu e primul redat, imediat după cercul „+".
    expect(getByLabelText('Vezi poveștile: Ivan')).toBeTruthy();
    // Match-urile rămân vizibile lângă el.
    expect(getByText('Ana')).toBeTruthy();
  });

  it('apăsarea pe propriul cerc deschide propriile povești', async () => {
    mockFetchStories.mockResolvedValue([
      { userId: 'me', name: 'Ivan', storyCount: 1, stories: [] },
    ]);
    const { getByLabelText } = renderBar();

    await waitFor(() => expect(getByLabelText('Vezi poveștile: Ivan')).toBeTruthy());
    fireEvent.press(getByLabelText('Vezi poveștile: Ivan'));
    expect(mockPush).toHaveBeenCalledWith('/stories/me');
  });

  it('apăsarea pe un cerc de utilizator navighează la poveștile lui', async () => {
    mockFetchStories.mockResolvedValue([
      { userId: 'u1', name: 'Ana', storyCount: 1, stories: [] },
    ]);
    const { getByLabelText } = renderBar();

    await waitFor(() => expect(getByLabelText('Vezi poveștile: Ana')).toBeTruthy());
    fireEvent.press(getByLabelText('Vezi poveștile: Ana'));
    expect(mockPush).toHaveBeenCalledWith('/stories/u1');
  });
});
