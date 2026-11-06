/**
 * Acțiunile pe mesaj: apăsare lungă → meniu (Răspunde / Copiază / Editează /
 * Șterge), editare cu PATCH, ștergere cu confirmare, răspuns din meniu și prin
 * glisare spre stânga, mesajele șterse fără meniu, citatul cu salt la original.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/authStore';
import { renderWithProviders } from '@/test/harness';

import { ChatScreen } from '../ChatScreen';
import type { ChatMessageEx, ChatSummaryEx } from '../chatApi';
import { CHAT_ROUTE_PATTERN, chatPath } from '../chatRoutes';
import { LONG_PRESS_MS } from '../useMessageGestures';

vi.mock('../chatApi', () => ({
  fetchChats: vi.fn(),
  fetchMessagesPage: vi.fn(),
  markRead: vi.fn(),
  reactToMessage: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock('@/features/ai', () => ({ AiAssistBar: () => null }));

vi.mock('@/telegram/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/telegram/bridge')>()),
  haptic: vi.fn(),
}));

const { fetchChats, fetchMessagesPage, markRead, sendMessage, editMessage, deleteMessage } =
  await import('../chatApi');
const { haptic } = await import('@/telegram/bridge');

const ME = 'me-id';
const CHAT: ChatSummaryEx = {
  chatId: 'c1',
  otherUserId: 'u1',
  otherName: 'Ana',
  lastMessage: 'Bună!',
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  compatibility: 91,
};

function msg(over: Partial<ChatMessageEx> & { id: string }): ChatMessageEx {
  return {
    senderId: 'u1',
    body: 'Salut',
    wasMasked: false,
    isRead: true,
    createdAt: '2026-09-01T10:00:00Z',
    reaction: null,
    kind: 'text',
    attachment: null,
    editedAt: null,
    isDeleted: false,
    replyTo: null,
    ...over,
  };
}

const PARTNER = msg({ id: 'm1', senderId: 'u1', body: 'Salut!', createdAt: '2026-09-01T10:00:00Z' });
const OWN = msg({ id: 'm2', senderId: ME, body: 'Bună!', createdAt: '2026-09-01T10:01:00Z' });

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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Zona de gesturi a bulei care conține textul dat. */
function zoneOf(text: string): HTMLElement {
  const bubble = screen.getByText(text).closest('[data-testid="message-bubble"]') as HTMLElement;
  return bubble.querySelector('.bubble-swipe') as HTMLElement;
}

async function longPress(text: string) {
  const target = screen.getByText(text);
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
  await act(async () => {
    await wait(LONG_PRESS_MS + 60);
  });
  fireEvent.pointerUp(target, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
}

function menuActions(): string[] {
  const menu = screen.getByTestId('message-menu');
  return within(menu)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('data-testid') ?? '')
    .filter((id) => id.startsWith('message-action-'))
    .map((id) => id.replace('message-action-', ''));
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: ME, email: 'me@test.local', profile_completed: true },
    error: null,
  });
  vi.mocked(fetchChats).mockResolvedValue([CHAT]);
  vi.mocked(fetchMessagesPage).mockResolvedValue({ items: [PARTNER, OWN], nextCursor: null });
  vi.mocked(markRead).mockResolvedValue(undefined);
  vi.mocked(sendMessage).mockImplementation(async (_c, body) =>
    msg({ id: 'm3', senderId: ME, body, createdAt: '2026-09-01T10:02:00Z' }),
  );
  vi.mocked(haptic).mockClear();
});

describe('apăsarea lungă', () => {
  it('pe mesajul partenerului: reacții + Răspunde / Copiază, fără Editează / Șterge', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    await longPress('Salut!');

    expect(screen.getByTestId('message-menu')).toBeInTheDocument();
    expect(screen.getByTestId('reaction-picker')).toBeInTheDocument();
    expect(menuActions()).toEqual(['reply', 'copy']);
    expect(haptic).toHaveBeenCalledWith('medium');
  });

  it('pe mesajul propriu: Răspunde / Copiază / Editează / Șterge', async () => {
    await renderChat();
    await screen.findByText('Bună!');

    await longPress('Bună!');

    expect(menuActions()).toEqual(['reply', 'copy', 'edit', 'delete']);
  });

  it('mișcarea degetului anulează apăsarea lungă (derulare)', async () => {
    await renderChat();
    const target = await screen.findByText('Salut!');

    fireEvent.pointerDown(target, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 102, clientY: 140 });
    await act(async () => {
      await wait(LONG_PRESS_MS + 60);
    });

    expect(screen.queryByTestId('message-menu')).not.toBeInTheDocument();
  });

  it('clic-dreapta (desktop) deschide meniul; Escape îl închide', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    fireEvent.contextMenu(screen.getByText('Salut!'));
    expect(screen.getByTestId('message-menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('message-menu')).not.toBeInTheDocument();
  });

  it('atingerea fundalului închide meniul', async () => {
    await renderChat();
    fireEvent.click(await screen.findByText('Salut!'));

    const backdrop = screen.getByTestId('message-menu-backdrop');
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByTestId('message-menu')).not.toBeInTheDocument();
  });
});

describe('editarea', () => {
  it('Editează → bara „Editare", câmp precompletat, PATCH, eticheta „editat"', async () => {
    const edited = { ...OWN, body: 'Bună seara!', editedAt: '2026-09-01T10:05:00Z' };
    vi.mocked(editMessage).mockResolvedValue(edited);
    await renderChat();
    await screen.findByText('Bună!');

    // Ciorna de dinainte se întoarce după editare.
    const input = screen.getByRole('textbox', { name: 'Scrie un mesaj…' });
    fireEvent.change(input, { target: { value: 'ciorna mea' } });

    fireEvent.click(screen.getByText('Bună!'));
    fireEvent.click(screen.getByTestId('message-action-edit'));

    expect(screen.getByTestId('edit-bar')).toHaveTextContent('Editare mesaj');
    expect(input).toHaveValue('Bună!');
    // În editare nu se atașează nimic.
    expect(screen.queryByTestId('attach-button')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Bună seara!' } });
    vi.mocked(fetchMessagesPage).mockResolvedValue({ items: [PARTNER, edited], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Salvează modificarea' }));

    await waitFor(() => expect(editMessage).toHaveBeenCalledWith('c1', 'm2', 'Bună seara!'));
    expect(await screen.findByText('Bună seara!')).toBeInTheDocument();
    expect(screen.getByTestId('edited-label')).toHaveTextContent('editat');
    expect(screen.queryByTestId('edit-bar')).not.toBeInTheDocument();
    expect(input).toHaveValue('ciorna mea');
  });

  it('X anulează editarea și readuce ciorna', async () => {
    await renderChat();
    await screen.findByText('Bună!');
    const input = screen.getByRole('textbox', { name: 'Scrie un mesaj…' });
    fireEvent.change(input, { target: { value: 'ciorna' } });

    fireEvent.click(screen.getByText('Bună!'));
    fireEvent.click(screen.getByTestId('message-action-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Anulează editarea' }));

    expect(screen.queryByTestId('edit-bar')).not.toBeInTheDocument();
    expect(input).toHaveValue('ciorna');
    expect(editMessage).not.toHaveBeenCalled();
  });

  it('409 (mesaj șters între timp): eroare tradusă în composer', async () => {
    vi.mocked(editMessage).mockRejectedValue({ response: { status: 409 } });
    await renderChat();
    await screen.findByText('Bună!');

    fireEvent.click(screen.getByText('Bună!'));
    fireEvent.click(screen.getByTestId('message-action-edit'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Scrie un mesaj…' }), {
      target: { value: 'Altceva' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvează modificarea' }));

    expect(await screen.findByTestId('edit-error')).toHaveTextContent('Mesajul a fost șters');
  });
});

describe('ștergerea', () => {
  it('Șterge → confirmare → DELETE → bula devine „Mesaj șters"', async () => {
    vi.mocked(deleteMessage).mockResolvedValue({
      ...OWN,
      body: '',
      isDeleted: true,
      reaction: null,
      attachment: null,
    });
    await renderChat();
    await screen.findByText('Bună!');

    fireEvent.click(screen.getByText('Bună!'));
    fireEvent.click(screen.getByTestId('message-action-delete'));

    const dialog = screen.getByTestId('delete-message-dialog');
    expect(dialog).toHaveTextContent('Va fi șters pentru amândoi.');
    expect(deleteMessage).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId('delete-message-confirm'));

    await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith('c1', 'm2'));
    expect(await screen.findByTestId('deleted-message')).toHaveTextContent('Mesaj șters');
    expect(screen.queryByText('Bună!')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-message-dialog')).not.toBeInTheDocument();
  });

  it('eșecul rămâne în dialog, mesajul neatins', async () => {
    vi.mocked(deleteMessage).mockRejectedValue(new Error('offline'));
    await renderChat();
    await screen.findByText('Bună!');

    fireEvent.click(screen.getByText('Bună!'));
    fireEvent.click(screen.getByTestId('message-action-delete'));
    fireEvent.click(screen.getByTestId('delete-message-confirm'));

    expect(await screen.findByTestId('delete-message-error')).toBeInTheDocument();
    expect(screen.getByText('Bună!')).toBeInTheDocument();
  });
});

describe('răspunsul', () => {
  it('Răspunde din meniu → bara de răspuns → trimite cu `reply_to_id`', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    fireEvent.click(screen.getByText('Salut!'));
    fireEvent.click(screen.getByTestId('message-action-reply'));

    const bar = screen.getByTestId('reply-bar');
    expect(bar).toHaveTextContent('Ana');
    expect(within(bar).getByText('Salut!')).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Scrie un mesaj…' });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'Și ție!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trimite' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c1', 'Și ție!', 'm1'));
    await waitFor(() => expect(screen.queryByTestId('reply-bar')).not.toBeInTheDocument());
  });

  it('glisarea spre stânga pe bulă setează răspunsul', async () => {
    await renderChat();
    await screen.findByText('Salut!');
    const zone = zoneOf('Salut!');
    const target = screen.getByText('Salut!');

    fireEvent.pointerDown(target, { pointerId: 7, pointerType: 'touch', clientX: 200, clientY: 100 });
    fireEvent.pointerMove(target, { pointerId: 7, pointerType: 'touch', clientX: 170, clientY: 102 });
    fireEvent.pointerMove(target, { pointerId: 7, pointerType: 'touch', clientX: 120, clientY: 104 });
    // Bula urmează degetul.
    expect((zone.querySelector('.bubble-swipe__track') as HTMLElement).style.transform).toMatch(
      /translateX\(-/,
    );
    fireEvent.pointerUp(target, { pointerId: 7, pointerType: 'touch', clientX: 120, clientY: 104 });
    // Clicul sintetic de după glisare nu deschide meniul.
    fireEvent.click(target);

    expect(screen.getByTestId('reply-bar')).toHaveTextContent('Ana');
    expect(screen.queryByTestId('message-menu')).not.toBeInTheDocument();
    expect(haptic).toHaveBeenCalledWith('medium');
  });

  it('o glisare scurtă (sub prag) nu face nimic', async () => {
    await renderChat();
    const target = await screen.findByText('Salut!');

    fireEvent.pointerDown(target, { pointerId: 7, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(target, { pointerId: 7, clientX: 170, clientY: 100 });
    fireEvent.pointerUp(target, { pointerId: 7, clientX: 170, clientY: 100 });

    expect(screen.queryByTestId('reply-bar')).not.toBeInTheDocument();
  });

  it('bula cu `reply_to` arată citatul; atingerea lui evidențiază originalul', async () => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [
        PARTNER,
        msg({
          id: 'm4',
          senderId: ME,
          body: 'Răspunsul meu',
          createdAt: '2026-09-01T10:03:00Z',
          replyTo: { id: 'm1', senderId: 'u1', body: 'Salut!', kind: 'text', isDeleted: false },
        }),
      ],
      nextCursor: null,
    });
    await renderChat();
    await screen.findByText('Răspunsul meu');

    const quote = screen.getByTestId('reply-quote');
    expect(quote).toHaveTextContent('Ana');
    expect(quote).toHaveTextContent('Salut!');

    fireEvent.click(quote);
    // Saltul nu deschide meniul bulei care conține citatul.
    expect(screen.queryByTestId('message-menu')).not.toBeInTheDocument();
    const original = document.querySelector('[data-message-id="m1"]');
    expect(original).toHaveClass('bubble-wrap--highlight');
  });

  it('citatul unui mesaj șters arată „Mesaj șters"', async () => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [
        msg({
          id: 'm4',
          senderId: 'u1',
          body: 'Ok',
          replyTo: { id: 'm0', senderId: ME, body: '', kind: 'image', isDeleted: true },
        }),
      ],
      nextCursor: null,
    });
    await renderChat();

    const quote = await screen.findByTestId('reply-quote');
    expect(quote).toHaveTextContent('Tu');
    expect(quote).toHaveTextContent('Mesaj șters');
  });
});

describe('mesajele șterse', () => {
  it('bulă estompată, fără reacție și fără meniu', async () => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [msg({ id: 'm1', senderId: 'u1', body: '', isDeleted: true, reaction: '❤️' })],
      nextCursor: null,
    });
    await renderChat();

    const deleted = await screen.findByTestId('deleted-message');
    expect(deleted).toHaveTextContent('Mesaj șters');
    expect(screen.queryByTestId('reaction-badge')).not.toBeInTheDocument();

    fireEvent.click(deleted);
    fireEvent.contextMenu(deleted);
    fireEvent.pointerDown(deleted, { pointerId: 1, clientX: 100, clientY: 100 });
    await act(async () => {
      await wait(LONG_PRESS_MS + 60);
    });
    expect(screen.queryByTestId('message-menu')).not.toBeInTheDocument();
  });
});
