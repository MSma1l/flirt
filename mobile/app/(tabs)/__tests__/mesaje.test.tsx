import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import MesajeScreen from '../mesaje';
import { ThemeProvider } from '@theme/index';
import type { ChatSummary } from '@/features/chat/types';

// Mock router (evită navigarea reală expo-router în teste).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

// Mock la chatApi: controlăm lista de dialoguri.
const mockFetchChats = jest.fn<Promise<ChatSummary[]>, []>(() => Promise.resolve([]));
jest.mock('@/features/chat/chatApi', () => ({
  fetchChats: () => mockFetchChats(),
}));

const chats: ChatSummary[] = [
  {
    chatId: 'c1',
    otherUserId: 'u1',
    otherName: 'Ana',
    unreadCount: 0,
    compatibility: 82,
    lastMessage: 'Salut!',
  },
  {
    chatId: 'c2',
    otherUserId: 'u2',
    otherName: 'Maria',
    unreadCount: 2,
    compatibility: 70,
  },
];

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MesajeScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('MesajeScreen', () => {
  beforeEach(() => {
    mockFetchChats.mockReset();
    mockPush.mockClear();
  });

  it('randează lista de chat-uri din fetchChats', async () => {
    mockFetchChats.mockResolvedValue(chats);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ana'));
    expect(getByText('Maria')).toBeTruthy();
    expect(getByText('Salut!')).toBeTruthy();
  });

  it('afișează starea goală când nu există chat-uri', async () => {
    mockFetchChats.mockResolvedValue([]);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Mesajele apar aici după un match 💬'));
  });

  it('tap pe un chat navighează la /chat/{id}', async () => {
    mockFetchChats.mockResolvedValue(chats);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ana'));
    fireEvent.press(getByText('Ana'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/chat/c1');
    });
  });
});
