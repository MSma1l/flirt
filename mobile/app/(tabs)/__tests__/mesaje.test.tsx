import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import MesajeScreen from '../mesaje';
import type { ChatSummary } from '@/features/chat/types';
import type { PendingLikeItem } from '@/features/social/socialApi';
import i18n from '@/i18n';
import enChat from '@/i18n/locales/en/chat.json';
import { ThemeProvider } from '@theme/index';

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

// Mock la lista „în așteptare": secțiunea de pending are testul ei separat.
const mockFetchPending = jest.fn<Promise<{ items: PendingLikeItem[]; nextCursor: string | null }>, []>(
  () => Promise.resolve({ items: [], nextCursor: null }),
);
jest.mock('@/features/social/socialApi', () => ({
  fetchPendingLikesPage: () => mockFetchPending(),
}));

const chats: ChatSummary[] = [
  // Citit, cu mesaj → „Conversații".
  {
    chatId: 'c1',
    otherUserId: 'u1',
    otherName: 'Ana',
    unreadCount: 0,
    compatibility: 82,
    lastMessage: 'Salut!',
  },
  // Necitit → „Match nou".
  {
    chatId: 'c2',
    otherUserId: 'u2',
    otherName: 'Maria',
    unreadCount: 2,
    compatibility: 70,
    lastMessage: 'Hey',
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
    mockFetchPending.mockReset();
    mockFetchPending.mockResolvedValue({ items: [], nextCursor: null });
    mockPush.mockClear();
  });

  afterEach(async () => {
    await i18n.changeLanguage('ro');
  });

  it('randează lista de chat-uri din fetchChats', async () => {
    mockFetchChats.mockResolvedValue(chats);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ana'));
    expect(getByText('Maria')).toBeTruthy();
    expect(getByText('Salut!')).toBeTruthy();
  });

  it('grupează match-urile: necitit sub „Match nou", citit sub „Conversații"', async () => {
    mockFetchChats.mockResolvedValue(chats);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Match nou'));
    expect(getByText('Conversații')).toBeTruthy();
  });

  it('ascunde secțiunea „Match nou" când nu există match-uri necitite', async () => {
    mockFetchChats.mockResolvedValue([chats[0]]); // doar cel citit
    const { getByText, queryByText } = renderScreen();

    await waitFor(() => getByText('Conversații'));
    expect(queryByText('Match nou')).toBeNull();
  });

  it('afișează starea goală când nu există chat-uri', async () => {
    mockFetchChats.mockResolvedValue([]);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Mesajele apar aici după un match 💬'));
  });

  it('tap pe un match deschide chatul /chat/{id}', async () => {
    mockFetchChats.mockResolvedValue(chats);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ana'));
    fireEvent.press(getByText('Ana'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/chat/c1');
    });
  });

  it('titlurile secțiunilor apar în limba curentă (en)', async () => {
    await i18n.changeLanguage('en');
    mockFetchChats.mockResolvedValue(chats);
    const { getByText } = renderScreen();

    await waitFor(() => getByText(enChat.sections.newTitle));
    expect(getByText(enChat.sections.activeTitle)).toBeTruthy();
  });
});
