import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import HumorScreen from '../humor';
import { ThemeProvider } from '@theme/index';
import type { HumorCard } from '@/features/humor/types';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Mock la humorApi: cardurile testului + spionăm submit-ul.
const mockFetchQuiz = jest.fn<Promise<HumorCard[]>, []>(() => Promise.resolve([]));
const mockSubmitQuiz = jest.fn((_answers: unknown) => Promise.resolve({ vector: {} }));
jest.mock('@/features/humor/humorApi', () => ({
  fetchQuiz: () => mockFetchQuiz(),
  submitQuiz: (answers: unknown) => mockSubmitQuiz(answers),
}));

const cards: HumorCard[] = [
  { id: 'h1', text: 'Prima glumă', type: 'pun' },
  { id: 'h2', text: 'A doua glumă', type: 'absurd' },
];

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <HumorScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('HumorScreen', () => {
  beforeEach(() => {
    mockFetchQuiz.mockReset();
    mockSubmitQuiz.mockReset();
    mockSubmitQuiz.mockResolvedValue({ vector: {} });
  });

  it('parcurge cardurile și la final apelează submitQuiz cu răspunsurile', async () => {
    mockFetchQuiz.mockResolvedValue(cards);
    const { getByTestId, getByText } = renderScreen();

    // Primul card.
    await waitFor(() => getByText('Prima glumă'));
    fireEvent.press(getByTestId('humor-funny'));

    // Al doilea card → răspunsul final declanșează submit-ul.
    await waitFor(() => getByText('A doua glumă'));
    fireEvent.press(getByTestId('humor-not-funny'));

    await waitFor(() => {
      expect(mockSubmitQuiz).toHaveBeenCalledWith([
        { cardId: 'h1', funny: true },
        { cardId: 'h2', funny: false },
      ]);
    });

    // La succes se arată confirmarea.
    await waitFor(() => getByTestId('humor-done'));
    expect(getByText('Profilul tău de umor a fost salvat 🎭')).toBeTruthy();
  });

  it('onError afișează mesaj și buton de reîncercare', async () => {
    mockFetchQuiz.mockResolvedValue([cards[0]]);
    mockSubmitQuiz.mockRejectedValueOnce(new Error('boom'));
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByText('Prima glumă'));
    fireEvent.press(getByTestId('humor-funny'));

    await waitFor(() => getByText('Nu am putut salva. Reîncearcă.'));
    expect(getByTestId('humor-retry')).toBeTruthy();
  });
});
