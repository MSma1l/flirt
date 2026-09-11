/**
 * Conversația: deschidere din listă, istoric paginat, trimitere, reacții,
 * raportare, stări oneste și — regula de produs — afișarea textului MASCAT de
 * server exact așa cum vine.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatSummary } from '@mobile/features/chat/types';

import { useAuthStore } from '@/auth/authStore';
import { CHATS_PATH } from '@/features/onboarding/paths';
import { renderWithProviders } from '@/test/harness';

import { ChatListScreen } from '../ChatListScreen';
import { ChatScreen, MESSAGES_POLL_MS } from '../ChatScreen';
import { CHAT_ROUTE_PATTERN, chatPath } from '../chatRoutes';

vi.mock('../chatApi', () => ({
  fetchChats: vi.fn(),
  fetchMessagesPage: vi.fn(),
  markRead: vi.fn(),
  reactToMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

// Raportarea REUTILIZEAZĂ cererea din aplicația Expo; aici izolăm doar rețeaua.
vi.mock('@mobile/features/moderation/reportApi', () => ({ sendReport: vi.fn() }));

const { fetchChats, fetchMessagesPage, markRead, reactToMessage, sendMessage } =
  await import('../chatApi');
const { sendReport } = await import('@mobile/features/moderation/reportApi');

const ME = 'me-id';
const CHAT: ChatSummary = {
  chatId: 'c1',
  otherUserId: 'u1',
  otherName: 'Ana',
  lastMessage: 'Salut',
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  compatibility: 91,
};

function msg(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    senderId: 'u1',
    body: 'Salut',
    wasMasked: false,
    isRead: true,
    createdAt: '2026-09-01T10:00:00Z',
    reaction: null,
    ...over,
  };
}

const MESSAGES: ChatMessage[] = [
  msg({ id: 'm1', senderId: 'u1', body: 'Salut!', createdAt: '2026-09-01T10:00:00Z' }),
  msg({ id: 'm2', senderId: ME, body: 'Bună!', createdAt: '2026-09-01T10:01:00Z' }),
];

/**
 * Randează ecranul și lasă interogările pornite la montare (mesaje + rezumatul
 * din `['chats']`) să se așeze. Fără asta, a doua promisiune s-ar rezolva după
 * aserțiile testului, iar React ar semnala o actualizare în afara lui `act`.
 */
async function renderChat(path: string = chatPath('c1')) {
  const result = renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={CHATS_PATH} element={<ChatListScreen />} />
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
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: ME, email: 'me@test.local', profile_completed: true },
    error: null,
  });
  vi.mocked(fetchChats).mockResolvedValue([CHAT]);
  vi.mocked(fetchMessagesPage).mockResolvedValue({ items: MESSAGES, nextCursor: null });
  vi.mocked(markRead).mockResolvedValue(undefined);
  vi.mocked(sendMessage).mockImplementation(async (_chatId: string, body: string) =>
    msg({ id: 'm3', senderId: ME, body, createdAt: '2026-09-01T10:02:00Z' }),
  );
  vi.mocked(reactToMessage).mockResolvedValue(msg({ id: 'm1', reaction: '❤️' }));
  vi.mocked(sendReport).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  // Starea de autentificare NU se resetează aici: `afterEach`-urile rulează în
  // ordine inversă, deci am scrie în store ÎNAINTE ca ecranul să fie demontat,
  // iar React ar semnala o actualizare în afara lui `act`. `beforeEach` o
  // rescrie oricum, complet, la fiecare test.
});

describe('deschiderea unei conversații', () => {
  it('din lista de dialoguri, clicul pe rând duce la conversație', async () => {
    await renderChat(CHATS_PATH);

    const row = await screen.findByTestId('chat-row');
    fireEvent.click(row);

    expect(await screen.findByRole('heading', { name: 'Ana' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMessagesPage).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText('Salut!')).toBeInTheDocument();
  });

  it('citește identificatorul din parametrul de rută și marchează dialogul citit', async () => {
    await renderChat();

    await screen.findByText('Salut!');
    await waitFor(() => expect(markRead).toHaveBeenCalledWith('c1'));
  });

  it('aliniază mesajele proprii separat de cele primite', async () => {
    await renderChat();

    const bubbles = await screen.findAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveAttribute('aria-label', 'mesaj primit');
    expect(bubbles[1]).toHaveAttribute('aria-label', 'mesaj propriu');
  });
});

describe('mascarea contactelor (regulă de produs)', () => {
  it('afișează textul mascat EXACT cum vine de la server și explică de ce', async () => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [
        msg({
          id: 'mm',
          senderId: ME,
          // Serverul a înlocuit numărul cu `****` ÎNAINTE de a salva mesajul.
          body: 'Sună-mă la **** sau scrie-mi pe telegram ****',
          wasMasked: true,
        }),
      ],
      nextCursor: null,
    });
    await renderChat();

    // Textul e afișat literal: interfața nu „repară" și nu ascunde mascarea.
    expect(
      await screen.findByText('Sună-mă la **** sau scrie-mi pe telegram ****'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('masked-hint')).toHaveTextContent(
      'Contact ascuns pentru siguranță',
    );
  });

  it('nu arată explicația când serverul nu a mascat nimic', async () => {
    await renderChat();

    await screen.findByText('Salut!');
    expect(screen.queryByTestId('masked-hint')).not.toBeInTheDocument();
  });
});

describe('trimiterea unui mesaj', () => {
  it('trimite textul curățat de spații și golește composerul', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    const input = screen.getByRole('textbox', { name: 'Scrie un mesaj…' });
    fireEvent.change(input, { target: { value: '  Ne vedem diseară  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trimite' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c1', 'Ne vedem diseară'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('butonul e inactiv cât timp mesajul e gol', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    expect(screen.getByRole('button', { name: 'Trimite' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Scrie un mesaj…' }), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: 'Trimite' })).toBeDisabled();
  });

  it('refuză marcajele HTML, simetric cu validarea din backend', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    fireEvent.change(screen.getByRole('textbox', { name: 'Scrie un mesaj…' }), {
      target: { value: '<img src=x onerror=alert(1)>' },
    });

    expect(screen.getByTestId('message-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trimite' })).toBeDisabled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('anunță mesajul netrimis când serverul respinge', async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('500'));
    await renderChat();
    await screen.findByText('Salut!');

    fireEvent.change(screen.getByRole('textbox', { name: 'Scrie un mesaj…' }), {
      target: { value: 'Bună' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trimite' }));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(
      'Mesajul nu a fost trimis. Reîncearcă.',
    );
    // Textul rămâne în composer: utilizatorul nu-și pierde mesajul.
    expect(screen.getByRole('textbox', { name: 'Scrie un mesaj…' })).toHaveValue('Bună');
  });
});

describe('stări oneste', () => {
  it('eroarea de la server se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchMessagesPage).mockRejectedValueOnce(new Error('500'));
    await renderChat();

    expect(await screen.findByTestId('messages-error')).toHaveTextContent(
      'Nu am putut încărca mesajele.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));
    expect(await screen.findByText('Salut!')).toBeInTheDocument();
  });

  it('conversația fără mesaje invită la primul mesaj', async () => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({ items: [], nextCursor: null });
    await renderChat();

    expect(await screen.findByTestId('messages-empty')).toHaveTextContent(
      'Scrie primul mesaj',
    );
    // Composerul rămâne disponibil — ecranul gol nu e un capăt de drum.
    expect(screen.getByRole('textbox', { name: 'Scrie un mesaj…' })).toBeInTheDocument();
  });

  it('fără rezumat în cache, titlul cade pe textul de rezervă', async () => {
    vi.mocked(fetchChats).mockResolvedValue([]);
    await renderChat();

    expect(await screen.findByRole('heading', { name: 'Conversație' })).toBeInTheDocument();
  });
});

describe('paginarea istoricului', () => {
  it('încarcă pagina mai veche prin cursorul din X-Next-Cursor', async () => {
    vi.mocked(fetchMessagesPage).mockImplementation(async (_chatId, cursor) =>
      cursor
        ? { items: [msg({ id: 'old', body: 'Primul mesaj', createdAt: '2026-08-01T09:00:00Z' })], nextCursor: null }
        : { items: MESSAGES, nextCursor: 'cursor-1' },
    );
    await renderChat();

    fireEvent.click(await screen.findByTestId('load-older'));

    await waitFor(() => expect(fetchMessagesPage).toHaveBeenCalledWith('c1', 'cursor-1'));
    expect(await screen.findByText('Primul mesaj')).toBeInTheDocument();

    // Capătul istoricului: butonul dispare.
    await waitFor(() => expect(screen.queryByTestId('load-older')).not.toBeInTheDocument());
  });

  it('anunță eșecul încărcării paginii mai vechi, fără să piardă ce e afișat', async () => {
    vi.mocked(fetchMessagesPage).mockImplementation(async (_chatId, cursor) => {
      if (cursor) throw new Error('offline');
      return { items: MESSAGES, nextCursor: 'cursor-1' };
    });
    await renderChat();

    fireEvent.click(await screen.findByTestId('load-older'));

    expect(await screen.findByTestId('load-older-error')).toHaveTextContent(
      'Nu am putut încărca mai multe.',
    );
    expect(screen.getByText('Salut!')).toBeInTheDocument();
  });
});

describe('reacții', () => {
  it('clicul pe bulă deschide picker-ul, iar alegerea trimite reacția', async () => {
    await renderChat();

    fireEvent.click(await screen.findByText('Salut!'));
    fireEvent.click(screen.getByRole('button', { name: 'Reacție ❤️' }));

    await waitFor(() =>
      expect(reactToMessage).toHaveBeenCalledWith('c1', 'm1', '❤️'),
    );
  });

  it('re-alegerea aceleiași reacții o scoate', async () => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [msg({ id: 'm1', body: 'Salut!', reaction: '❤️' })],
      nextCursor: null,
    });
    await renderChat();

    fireEvent.click(await screen.findByText('Salut!'));
    fireEvent.click(screen.getByRole('button', { name: 'Reacție ❤️' }));

    await waitFor(() => expect(reactToMessage).toHaveBeenCalledWith('c1', 'm1', null));
  });
});

describe('raportare', () => {
  it('trimite raportul cu categoria aleasă și id-ul dialogului', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    fireEvent.click(screen.getByTestId('chat-report'));
    fireEvent.click(await screen.findByRole('button', { name: 'Spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trimite raportul' }));

    await waitFor(() =>
      expect(sendReport).toHaveBeenCalledWith({
        reportedUserId: 'u1',
        category: 'spam',
        chatId: 'c1',
        note: '',
      }),
    );
    expect(await screen.findByText('Mulțumim, am primit raportul')).toBeInTheDocument();
  });

  it('anunță eșecul trimiterii raportului', async () => {
    vi.mocked(sendReport).mockRejectedValueOnce(new Error('500'));
    await renderChat();
    await screen.findByText('Salut!');

    fireEvent.click(screen.getByTestId('chat-report'));
    fireEvent.click(await screen.findByRole('button', { name: 'Profil fals' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trimite raportul' }));

    expect(await screen.findByTestId('report-error')).toBeInTheDocument();
  });
});

describe('actualizare periodică', () => {
  it('oprește interogarea conversației când fereastra nu e vizibilă', async () => {
    vi.useFakeTimers();
    await renderChat();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMessagesPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGES_POLL_MS + 50);
    });
    expect(fetchMessagesPage).toHaveBeenCalledTimes(2);

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGES_POLL_MS * 5);
    });
    expect(fetchMessagesPage).toHaveBeenCalledTimes(2);

    delete (document as unknown as Record<string, unknown>).visibilityState;
  });
});
