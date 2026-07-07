import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import ChatScreen from '../[id]';
import { ThemeProvider } from '@theme/index';
import type { ChatMessage } from '@/features/chat/types';

// Mock router + parametru de rută.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'c1' }),
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

// Mock store de auth: ecranul citește doar id-ul utilizatorului curent.
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'me' } }),
}));

// Mock la chatApi: control complet asupra mesajelor + spionăm mutațiile.
const mockFetchMessages = jest.fn<Promise<ChatMessage[]>, []>(() => Promise.resolve([]));
const mockSendMessage = jest.fn((_id: string, _body: string) => Promise.resolve());
const mockReact = jest.fn((_id: string, _mid: string, _r: string | null) => Promise.resolve());
const mockMarkRead = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/features/chat/chatApi', () => ({
  fetchMessages: () => mockFetchMessages(),
  sendMessage: (id: string, body: string) => mockSendMessage(id, body),
  reactToMessage: (id: string, mid: string, r: string | null) => mockReact(id, mid, r),
  markRead: (id: string) => mockMarkRead(id),
}));

const receivedMessage: ChatMessage = {
  id: 'm1',
  senderId: 'u1',
  body: 'Salut!',
  wasMasked: false,
  isRead: true,
  createdAt: '2026-07-01T10:00:00Z',
};

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ChatScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ChatScreen', () => {
  beforeEach(() => {
    mockFetchMessages.mockReset();
    mockFetchMessages.mockResolvedValue([]);
    mockSendMessage.mockClear();
    mockReact.mockClear();
    mockMarkRead.mockClear();
    mockBack.mockClear();
  });

  it('marchează dialogul ca citit la deschidere', async () => {
    renderScreen();
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('c1'));
  });

  it('trimite mesajul și golește câmpul', async () => {
    const { getByPlaceholderText, getByLabelText } = renderScreen();

    const input = getByPlaceholderText('Scrie un mesaj…');
    fireEvent.changeText(input, 'Bună!');
    fireEvent.press(getByLabelText('Trimite'));

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledWith('c1', 'Bună!'));
    // După succes, draftul este golit.
    await waitFor(() => expect(getByPlaceholderText('Scrie un mesaj…').props.value).toBe(''));
  });

  it('nu trimite un mesaj gol / doar spații', async () => {
    const { getByPlaceholderText, getByLabelText } = renderScreen();

    const input = getByPlaceholderText('Scrie un mesaj…');
    fireEvent.changeText(input, '    ');
    fireEvent.press(getByLabelText('Trimite'));

    // Butonul rămâne blocat, mutația nu se declanșează.
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalled());
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('long-press pe bulă deschide reacțiile și aplică o reacție', async () => {
    mockFetchMessages.mockResolvedValue([receivedMessage]);
    const { getByText, getByLabelText, getByTestId } = renderScreen();

    await waitFor(() => getByText('Salut!'));
    fireEvent(getByLabelText('Reacționează la mesaj'), 'longPress');
    fireEvent.press(getByTestId('reaction-option-❤️'));

    await waitFor(() => expect(mockReact).toHaveBeenCalledWith('c1', 'm1', '❤️'));
  });

  it('afișează starea de eroare cu retry', async () => {
    mockFetchMessages.mockRejectedValueOnce(new Error('boom'));
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Nu am putut încărca mesajele.'));

    mockFetchMessages.mockResolvedValue([receivedMessage]);
    fireEvent.press(getByText('Reîncearcă'));

    await waitFor(() => getByText('Salut!'));
  });
});
