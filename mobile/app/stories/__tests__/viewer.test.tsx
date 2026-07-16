import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import StoryViewerScreen from '../[userId]';
import { ThemeProvider } from '@theme/index';
import type { UserStories } from '@/features/stories/types';

// Mock router + parametru de rută.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ userId: 'u1' }),
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

// Id-ul utilizatorului curent — controlabil (proprietar vs. vizitator).
const mockAuth = { userId: 'me' };
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: mockAuth.userId } }),
}));

// Mock la storiesApi: sursă controlată + spionăm ștergerea.
const groups: UserStories[] = [
  {
    userId: 'u1',
    name: 'Ana',
    storyCount: 2,
    stories: [
      {
        id: 's1',
        userId: 'u1',
        mediaUrl: 'https://x/1.jpg',
        mediaType: 'image',
        caption: 'Prima poveste',
        createdAt: '2026-07-01T10:00:00Z',
        expiresAt: '2026-07-02T10:00:00Z',
      },
      {
        id: 's2',
        userId: 'u1',
        mediaUrl: 'https://x/2.mp4',
        mediaType: 'video',
        caption: 'A doua poveste',
        createdAt: '2026-07-01T11:00:00Z',
        expiresAt: '2026-07-02T11:00:00Z',
      },
    ],
  },
];
const mockFetchStories = jest.fn<Promise<UserStories[]>, []>(() => Promise.resolve(groups));
const mockDeleteStory = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/features/stories/storiesApi', () => ({
  fetchStories: () => mockFetchStories(),
  deleteStory: (id: string) => mockDeleteStory(id),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Sursa vizualizatorului este cache-ul din bara de stories.
  client.setQueryData(['stories'], groups);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <StoryViewerScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Randare FĂRĂ cache pre-populat (intrare directă, nu prin bara de stories). */
function renderColdScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <StoryViewerScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('StoryViewerScreen', () => {
  beforeEach(() => {
    mockFetchStories.mockReset();
    mockFetchStories.mockResolvedValue(groups);
    mockDeleteStory.mockClear();
    mockBack.mockClear();
    mockAuth.userId = 'me';
  });

  it('tap dreapta avansează la povestea următoare', () => {
    const { getByText, getByLabelText } = renderScreen();

    expect(getByText('Prima poveste')).toBeTruthy();
    fireEvent.press(getByLabelText('Povestea următoare'));
    expect(getByText('A doua poveste')).toBeTruthy();
  });

  it('tap dreapta pe ULTIMA poveste închide ecranul (router.back), o singură dată', () => {
    const { getByLabelText } = renderScreen();

    fireEvent.press(getByLabelText('Povestea următoare')); // s1 -> s2 (ultima)
    fireEvent.press(getByLabelText('Povestea următoare')); // ultima -> închide

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('avansul automat trece la povestea următoare, apoi închide — fără setState în randare', () => {
    jest.useFakeTimers();
    // `router.back()` se chema dintr-un updater de state, pe care React îl rulează
    // în timpul randării → avertisment „Cannot update a component while rendering".
    // Îl prindem ca eroare ca să nu se poată strecura înapoi.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { getByText } = renderScreen();

      expect(getByText('Prima poveste')).toBeTruthy();

      // Prima poveste expiră → avans automat la a doua.
      act(() => {
        // Puțin peste durata poveștii: pasul de progres (50/4000) se acumulează
        // în virgulă mobilă, deci pragul e atins la tick-ul imediat următor.
        jest.advanceTimersByTime(4200);
      });
      expect(getByText('A doua poveste')).toBeTruthy();
      expect(mockBack).not.toHaveBeenCalled();

      // A doua (ultima) expiră → se închide.
      act(() => {
        // Puțin peste durata poveștii: pasul de progres (50/4000) se acumulează
        // în virgulă mobilă, deci pragul e atins la tick-ul imediat următor.
        jest.advanceTimersByTime(4200);
      });
      expect(mockBack).toHaveBeenCalledTimes(1);

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('povestea video afișează media de tip video (nu imagine)', () => {
    const { getByTestId, queryByTestId, getByLabelText } = renderScreen();

    // Prima e imagine.
    expect(getByTestId('story-image')).toBeTruthy();

    // A doua e video → placeholder nativ de video, fără <Image>.
    fireEvent.press(getByLabelText('Povestea următoare'));
    expect(getByTestId('story-video-fallback')).toBeTruthy();
    expect(queryByTestId('story-image')).toBeNull();
  });

  it('proprietarul poate șterge povestea (deleteStory)', async () => {
    mockAuth.userId = 'u1';
    const { getByLabelText } = renderScreen();

    fireEvent.press(getByLabelText('Șterge povestea'));

    await waitFor(() => expect(mockDeleteStory).toHaveBeenCalledWith('s1'));
  });

  /* --- Fără cache: încărcare / eroare / gol trebuie să se distingă între ele --- */

  it('cât timp poveștile se încarcă arată spinner, NU mesajul de gol', async () => {
    // Promisiune ținută în aer: rămânem în starea de încărcare.
    let resolve: (v: UserStories[]) => void = () => {};
    mockFetchStories.mockReturnValue(
      new Promise<UserStories[]>((r) => {
        resolve = r;
      }),
    );

    const { getByTestId, queryByText } = renderColdScreen();

    expect(getByTestId('stories-loading')).toBeTruthy();
    expect(queryByText('Nu există povești de afișat.')).toBeNull();

    resolve(groups);
    await waitFor(() => expect(queryByText('Prima poveste')).toBeTruthy());
  });

  it('la eroare arată mesajul + „Reîncearcă", NU mesajul de gol', async () => {
    mockFetchStories.mockRejectedValueOnce(new Error('boom'));
    const { getByText, queryByText } = renderColdScreen();

    await waitFor(() => getByText('Nu am putut încărca poveștile.'));
    expect(queryByText('Nu există povești de afișat.')).toBeNull();

    // Retry: a doua oară datele vin.
    mockFetchStories.mockResolvedValue(groups);
    fireEvent.press(getByText('Reîncearcă'));

    await waitFor(() => getByText('Prima poveste'));
  });

  it('gol REAL (răspuns fără povești) → mesajul de gol cu „Închide"', async () => {
    mockFetchStories.mockResolvedValue([]);
    const { getByText, getByLabelText } = renderColdScreen();

    await waitFor(() => getByText('Nu există povești de afișat.'));

    fireEvent.press(getByLabelText('Închide'));
    expect(mockBack).toHaveBeenCalled();
  });
});
