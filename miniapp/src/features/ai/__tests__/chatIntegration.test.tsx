/**
 * Integrarea în conversația reală — testul care contează cel mai mult.
 *
 * Verifică lucrul pe care o interfață de asistent AI îl poate strica cel mai
 * urât: o sugestie plecată singură. Aici se demonstrează, pe ecranul întreg, că
 * textul propus ajunge în câmpul de scriere și rămâne acolo până când
 * UTILIZATORUL apasă „Trimite".
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatSummary } from '@mobile/features/chat/types';

vi.mock('@/features/chat/chatApi', () => ({
  fetchChats: vi.fn(),
  fetchMessagesPage: vi.fn(),
  markRead: vi.fn(),
  reactToMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/features/ai/aiApi', () => ({
  fetchChatHint: vi.fn(),
  fetchChemistry: vi.fn(),
}));

const aiEnabled = { value: true };
vi.mock('@/features/ai/aiSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../aiSettings')>()),
  useAiEnabled: () => ({
    enabled: aiEnabled.value,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { fetchChats, fetchMessagesPage, markRead, sendMessage } =
  await import('@/features/chat/chatApi');
const { fetchChatHint, fetchChemistry } = await import('@/features/ai/aiApi');
const { useAuthStore } = await import('@/auth/authStore');
const { renderWithProviders } = await import('@/test/harness');
const { ChatScreen } = await import('@/features/chat/ChatScreen');
const { CHAT_ROUTE_PATTERN, chatPath } = await import('@/features/chat/chatRoutes');

const ME = 'me-id';
const SUGGESTION = 'Ai încercat vreodată să faci parapantă?';

const CHAT: ChatSummary = {
  chatId: 'c1',
  otherUserId: 'u1',
  otherName: 'Ana',
  lastMessage: 'Salut',
  lastMessageAt: '2026-09-01T10:00:00Z',
  unreadCount: 0,
  compatibility: 91,
};

const MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    senderId: 'u1',
    body: 'Salut!',
    wasMasked: false,
    isRead: true,
    createdAt: '2026-09-01T10:00:00Z',
    reaction: null,
  },
];

async function renderChat() {
  const result = renderWithProviders(
    <MemoryRouter initialEntries={[chatPath('c1')]}>
      <Routes>
        <Route path={CHAT_ROUTE_PATTERN} element={<ChatScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  aiEnabled.value = true;
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: ME, email: 'me@test.local', profile_completed: true },
    error: null,
  });
  vi.mocked(fetchChats).mockResolvedValue([CHAT]);
  vi.mocked(fetchMessagesPage).mockResolvedValue({ items: MESSAGES, nextCursor: null });
  vi.mocked(markRead).mockResolvedValue(undefined);
  vi.mocked(sendMessage).mockResolvedValue(MESSAGES[0]!);
  vi.mocked(fetchChatHint).mockResolvedValue({ suggestions: [SUGGESTION], cached: false });
  vi.mocked(fetchChemistry).mockResolvedValue({
    score: 91,
    explanation: 'Aveți același fel de umor.',
    unavailable: null,
  });
});

describe('butonul apare doar când funcția e pornită', () => {
  it('lipsește cu totul când asistentul e oprit, fără nicio cerere la AI', async () => {
    aiEnabled.value = false;
    await renderChat();
    // Conversația funcționează normal fără asistent.
    expect(await screen.findByText('Salut!')).toBeInTheDocument();

    expect(screen.queryByTestId('ai-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-suggest')).not.toBeInTheDocument();
    expect(fetchChatHint).not.toHaveBeenCalled();
    expect(fetchChemistry).not.toHaveBeenCalled();
  });

  it('apare deasupra câmpului de scriere când asistentul e pornit', async () => {
    await renderChat();

    const bar = screen.getByTestId('ai-bar');
    const composer = screen.getByPlaceholderText('Scrie un mesaj…');
    expect(bar.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('sugestia NU se trimite singură', () => {
  it('cererea unei sugestii nu trimite niciun mesaj', async () => {
    await renderChat();

    await userEvent.click(screen.getByTestId('ai-suggest'));
    await screen.findByTestId('ai-suggestion-text-0');

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('inserarea o pune în câmp, fără s-o trimită', async () => {
    await renderChat();
    await userEvent.click(screen.getByTestId('ai-suggest'));
    await screen.findByTestId('ai-suggestion-insert-0');

    await userEvent.click(screen.getByTestId('ai-suggestion-insert-0'));

    expect(screen.getByPlaceholderText('Scrie un mesaj…')).toHaveValue(SUGGESTION);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('mesajul pleacă abia când utilizatorul apasă „Trimite"', async () => {
    await renderChat();
    await userEvent.click(screen.getByTestId('ai-suggest'));
    await screen.findByTestId('ai-suggestion-insert-0');
    await userEvent.click(screen.getByTestId('ai-suggestion-insert-0'));

    expect(sendMessage).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Trimite' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c1', SUGGESTION));
  });

  it('textul inserat poate fi schimbat înainte de trimitere — e ciorna userului', async () => {
    await renderChat();
    await userEvent.click(screen.getByTestId('ai-suggest'));
    await screen.findByTestId('ai-suggestion-insert-0');
    await userEvent.click(screen.getByTestId('ai-suggestion-insert-0'));

    const input = screen.getByPlaceholderText('Scrie un mesaj…');
    await userEvent.clear(input);
    await userEvent.type(input, 'Salut, Ana!');
    await userEvent.click(screen.getByRole('button', { name: 'Trimite' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c1', 'Salut, Ana!'));
  });
});

describe('scorul de chimie în conversație', () => {
  it('se deschide la cerere și explică cifra din antet', async () => {
    await renderChat();

    await userEvent.click(screen.getByTestId('ai-chemistry-open'));

    await waitFor(() => expect(fetchChemistry).toHaveBeenCalledWith('u1'));
    expect(await screen.findByTestId('ai-chemistry-score')).toHaveTextContent('Chimie: 91%');
    // Aceeași cifră cu badge-ul de compatibilitate din antet — scorul e cel
    // determinist, iar AI-ul adaugă doar explicația.
    expect(screen.getByLabelText(/91/)).toBeInTheDocument();
  });
});
