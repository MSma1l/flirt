import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import RequestDetailScreen from '../[userId]';
import type { ReceivedLikeItem } from '@/features/social/receivedApi';
import type { SwipeResult } from '@/features/feed/types';
import { ThemeProvider } from '@theme/index';

// Router: verificăm navigarea în chat la match și back-ul la „Trece".
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => ({ userId: 'u1' }),
}));

const mockFetchReceived = jest.fn();
jest.mock('@/features/social/receivedApi', () => ({
  fetchReceivedLikesPage: (params: unknown) => mockFetchReceived(params),
}));

const mockSwipe = jest.fn<Promise<SwipeResult>, [string, string, string?]>();
jest.mock('@/features/feed/feedApi', () => ({
  swipe: (userId: string, action: string, message?: string) => mockSwipe(userId, action, message),
}));

function makeItem(over: Partial<ReceivedLikeItem> = {}): ReceivedLikeItem {
  return {
    userId: 'u1',
    isSuper: false,
    message: 'Salut, mi-a plăcut profilul tău',
    createdAt: '2026-07-24T10:00:00Z',
    profile: {
      name: 'Ana',
      age: 25,
      gender: 'female',
      city: 'Chișinău',
      about: 'Îmi plac drumețiile.',
      photos: [],
      topInterests: ['muzică'],
      languages: ['ro'],
    },
    ...over,
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RequestDetailScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RequestDetailScreen', () => {
  beforeEach(() => {
    mockFetchReceived.mockReset();
    mockSwipe.mockReset();
    mockReplace.mockClear();
    mockBack.mockClear();
  });

  it('afișează ancheta și mesajul lor', async () => {
    mockFetchReceived.mockResolvedValue({ items: [makeItem()], nextCursor: null });
    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => getByText('Ana, 25'));
    expect(getByTestId('request-their-message')).toBeTruthy();
    expect(getByText('Salut, mi-a plăcut profilul tău')).toBeTruthy();
    expect(getByText('Îmi plac drumețiile.')).toBeTruthy();
  });

  it('răspunsul cu mesaj = swipe like + navigare în chat la match', async () => {
    mockFetchReceived.mockResolvedValue({ items: [makeItem()], nextCursor: null });
    mockSwipe.mockResolvedValue({ matched: true, chatId: 'c1' });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('request-reply-input'));
    fireEvent.changeText(getByTestId('request-reply-input'), 'Salut și ție!');
    fireEvent.press(getByTestId('request-reply-send'));

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'like', 'Salut și ție!');
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/chat/c1');
    });
  });

  it('„Trece" = swipe dislike + back', async () => {
    mockFetchReceived.mockResolvedValue({ items: [makeItem()], nextCursor: null });
    mockSwipe.mockResolvedValue({ matched: false });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('request-pass'));
    fireEvent.press(getByTestId('request-pass'));

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'dislike', undefined);
    });
    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });
  });

  it('afișează „nu mai există" când userId nu e în listă', async () => {
    mockFetchReceived.mockResolvedValue({ items: [], nextCursor: null });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('request-missing'));
  });
});
