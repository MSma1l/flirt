/**
 * Lista de dialoguri: randare pe secțiuni, stări oneste, oprirea polling-ului.
 *
 * Stratul de rețea e izolat la nivelul modulului propriu `chatApi` (care
 * re-exportă funcțiile reutilizate din aplicația Expo), ca testele să verifice
 * DECIZIILE ecranului, nu axios.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSummary } from '@mobile/features/chat/types';

import { renderWithProviders } from '@/test/harness';

import { ChatListScreen, CHATS_POLL_MS } from '../ChatListScreen';
import { chatPath } from '../chatRoutes';

vi.mock('../chatApi', () => ({
  fetchChats: vi.fn(),
  fetchMessagesPage: vi.fn(),
  markRead: vi.fn(),
  reactToMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

const { fetchChats } = await import('../chatApi');

const NOW = Date.now();

const CHATS: ChatSummary[] = [
  {
    chatId: 'c1',
    otherUserId: 'u1',
    otherName: 'Ana',
    // Necitite → secțiunea „Match nou".
    lastMessage: 'Ne vedem la ****',
    lastMessageAt: new Date(NOW - 2 * 60_000).toISOString(),
    unreadCount: 3,
    compatibility: 91,
  },
  {
    chatId: 'c2',
    otherUserId: 'u2',
    otherName: 'Bogdan',
    lastMessage: 'Salut!',
    lastMessageAt: new Date(NOW - 3 * 3_600_000).toISOString(),
    unreadCount: 0,
    compatibility: 42,
  },
];

function renderList() {
  return renderWithProviders(
    <MemoryRouter>
      <ChatListScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchChats).mockResolvedValue(CHATS);
});

afterEach(() => {
  vi.useRealTimers();
  // `visibilityState` e redefinit ca proprietate proprie în testul de polling;
  // o ștergem ca să revină getterul din jsdom.
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe('randarea listei', () => {
  it('arată interlocutorul, ultimul mesaj, ora și necititele', async () => {
    renderList();

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bogdan')).toBeInTheDocument();

    // Previzualizarea vine de la server DEJA mascată — o afișăm ca atare.
    expect(screen.getByText('Ne vedem la ****')).toBeInTheDocument();
    expect(screen.getByText('2 min')).toBeInTheDocument();
    expect(screen.getByText('3 h')).toBeInTheDocument();

    const unread = screen.getAllByTestId('chat-row-unread');
    expect(unread).toHaveLength(1);
    expect(unread[0]).toHaveTextContent('3');
    expect(unread[0]).toHaveAttribute('aria-label', '3 mesaje necitite');
  });

  it('grupează pe secțiuni: necititele sus, conversațiile citite dedesubt', async () => {
    renderList();

    expect(await screen.findByRole('heading', { name: 'Match nou' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conversații' })).toBeInTheDocument();

    // Rândul „Ana" (necitit) e înaintea rândului „Bogdan" în ordinea din DOM.
    const rows = screen.getAllByTestId('chat-row');
    expect(rows[0]).toHaveTextContent('Ana');
    expect(rows[1]).toHaveTextContent('Bogdan');
  });

  it('nu randează secțiuni goale', async () => {
    vi.mocked(fetchChats).mockResolvedValue([CHATS[1] as ChatSummary]);
    renderList();

    expect(await screen.findByRole('heading', { name: 'Conversații' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Match nou' })).not.toBeInTheDocument();
  });

  it('linkul rândului duce la conversația corectă', async () => {
    renderList();

    const rows = await screen.findAllByTestId('chat-row');
    expect(rows[0]).toHaveAttribute('href', chatPath('c1'));
  });
});

describe('stări oneste', () => {
  it('lista goală are un text explicativ, nu un ecran alb', async () => {
    vi.mocked(fetchChats).mockResolvedValue([]);
    renderList();

    expect(await screen.findByTestId('chats-empty')).toHaveTextContent(
      'Mesajele apar aici după un match',
    );
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchChats).mockRejectedValueOnce(new Error('offline'));
    renderList();

    expect(await screen.findByTestId('chats-error')).toHaveTextContent(
      'Nu am putut încărca mesajele.',
    );

    vi.mocked(fetchChats).mockResolvedValue(CHATS);
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByText('Ana')).toBeInTheDocument();
  });
});

/** Forțează `document.visibilityState` și anunță schimbarea, ca browserul. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('actualizare periodică', () => {
  it('reinterogează la interval cât timp fereastra e vizibilă, și tace când nu mai e', async () => {
    vi.useFakeTimers();
    renderList();

    // Prima interogare, la montare.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchChats).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATS_POLL_MS + 50);
    });
    expect(fetchChats).toHaveBeenCalledTimes(2);

    // Fereastra devine invizibilă: polling-ul trebuie să TACĂ, altfel Mini
    // App-ul ar consuma baterie și trafic în fundalul WebView-ului.
    await act(async () => setVisibility('hidden'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATS_POLL_MS * 3);
    });
    expect(fetchChats).toHaveBeenCalledTimes(2);

    // …și repornește la revenirea în prim-plan.
    await act(async () => setVisibility('visible'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATS_POLL_MS + 50);
    });
    expect(vi.mocked(fetchChats).mock.calls.length).toBeGreaterThan(2);
  });
});
