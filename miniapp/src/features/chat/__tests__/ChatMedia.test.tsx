/**
 * Conversația — partea nouă: emoji la cursor, atașamente (validare, foaia de
 * previzualizare, upload optimist, erori), randarea pozelor / video-urilor /
 * vocalelor, microfonul ascuns fără `MediaRecorder`, bifele și emoji-urile mari.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/authStore';
import { renderWithProviders } from '@/test/harness';

import type { ChatMessageEx, ChatSummaryEx } from '../chatApi';
import { ChatListRow } from '../ChatListRow';
import { ChatScreen } from '../ChatScreen';
import { CHAT_ROUTE_PATTERN, chatPath } from '../chatRoutes';

vi.mock('../chatApi', () => ({
  fetchChats: vi.fn(),
  fetchMessagesPage: vi.fn(),
  markRead: vi.fn(),
  reactToMessage: vi.fn(),
  sendMessage: vi.fn(),
  uploadAttachment: vi.fn(),
}));
vi.mock('@mobile/features/moderation/reportApi', () => ({ sendReport: vi.fn() }));
vi.mock('@/features/ai', () => ({ AiAssistBar: () => null }));

const { fetchChats, fetchMessagesPage, markRead, uploadAttachment } = await import('../chatApi');

const ME = 'me-id';
const MB = 1024 * 1024;

const CHAT: ChatSummaryEx = {
  chatId: 'c1',
  otherUserId: 'u1',
  otherName: 'Ana',
  otherAge: 24,
  otherCity: 'Chisinau',
  lastMessage: 'Salut',
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  compatibility: 91,
};

function msg(over: Partial<ChatMessageEx> & { id: string }): ChatMessageEx {
  return {
    senderId: 'u1',
    body: 'Salut!',
    wasMasked: false,
    isRead: true,
    createdAt: new Date().toISOString(),
    reaction: null,
    kind: 'text',
    attachment: null,
    ...over,
  };
}

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

function bigFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function pickFile(file: File) {
  fireEvent.change(screen.getByTestId('attach-input'), { target: { files: [file] } });
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: ME, email: 'me@test.local', profile_completed: true },
    error: null,
  });
  try {
    window.localStorage.clear();
  } catch {
    /* fără stocare */
  }
  vi.mocked(fetchChats).mockResolvedValue([CHAT]);
  vi.mocked(fetchMessagesPage).mockResolvedValue({
    items: [msg({ id: 'm1' })],
    nextCursor: null,
  });
  vi.mocked(markRead).mockResolvedValue(undefined);
  vi.mocked(uploadAttachment).mockReset();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).MediaRecorder;
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
});

describe('emoji', () => {
  it('inserează emoji-ul la poziția cursorului și îl ține în recente', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    const input = screen.getByRole('textbox', { name: 'Scrie un mesaj…' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Salut lume' } });
    input.setSelectionRange(5, 5);

    fireEvent.click(screen.getByTestId('emoji-toggle'));
    const picker = screen.getByTestId('emoji-picker');
    fireEvent.click(within(picker).getByRole('button', { name: '😍' }));

    expect(input).toHaveValue('Salut😍 lume');
    expect(JSON.parse(window.localStorage.getItem('flirt.chat.recentEmoji') ?? '[]')).toEqual([
      '😍',
    ]);
  });
});

describe('microfonul', () => {
  it('lipsește fără MediaRecorder: rămâne doar butonul de trimitere', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    expect(screen.queryByTestId('mic-button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trimite' })).toBeDisabled();
  });

  it('cu MediaRecorder: microfon când câmpul e gol, trimitere când există text', async () => {
    (window as unknown as Record<string, unknown>).MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
      },
    });
    await renderChat();
    await screen.findByText('Salut!');

    expect(screen.getByTestId('mic-button')).toBeInTheDocument();

    // Permisiunea refuzată: mesaj tradus, fără blocaj.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    expect(await screen.findByTestId('voice-error')).toHaveTextContent('microfon');

    fireEvent.change(screen.getByRole('textbox', { name: 'Scrie un mesaj…' }), {
      target: { value: 'Bună' },
    });
    expect(screen.queryByTestId('mic-button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trimite' })).toBeEnabled();
  });
});

describe('atașamente', () => {
  it('refuză o poză prea mare înainte de upload', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    pickFile(bigFile('mare.jpg', 'image/jpeg', 11 * MB));

    expect(await screen.findByTestId('media-error')).toHaveTextContent('10 MB');
    expect(screen.queryByTestId('media-preview')).not.toBeInTheDocument();
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('refuză un video peste 50 MB și un tip necunoscut', async () => {
    await renderChat();
    await screen.findByText('Salut!');

    pickFile(bigFile('lung.mp4', 'video/mp4', 51 * MB));
    expect(await screen.findByTestId('media-error')).toHaveTextContent('50 MB');

    pickFile(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }));
    expect(await screen.findByTestId('media-error')).toHaveTextContent('nu e acceptat');
  });

  it('previzualizare → trimitere cu descriere → bulă optimistă cu progres', async () => {
    let finish: (() => void) | undefined;
    vi.mocked(uploadAttachment).mockImplementation(
      (_chatId, _blob, options) =>
        new Promise((resolve) => {
          options?.onProgress?.(0.4);
          finish = () => resolve(msg({ id: 'srv', senderId: ME, kind: 'image' }));
        }),
    );
    await renderChat();
    await screen.findByText('Salut!');

    const photo = new File(['img'], 'poza.jpg', { type: 'image/jpeg' });
    pickFile(photo);

    const sheet = await screen.findByTestId('media-preview');
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: ' Uite ' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId('media-preview-send'));
    });

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
    const [chatId, blob, options] = vi.mocked(uploadAttachment).mock.calls[0]!;
    expect(chatId).toBe('c1');
    expect(blob).toBe(photo);
    expect(options).toMatchObject({ caption: 'Uite', fileName: 'poza.jpg' });

    const progress = await screen.findByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByTestId('media-preview')).not.toBeInTheDocument();

    await act(async () => {
      finish?.();
    });
    await waitFor(() => expect(screen.queryByTestId('upload-pending')).not.toBeInTheDocument());
  });

  it('eroarea 413 de la server se traduce și se poate reîncerca', async () => {
    const tooLarge = new AxiosError('too large', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 413,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    });
    vi.mocked(uploadAttachment)
      .mockRejectedValueOnce(tooLarge)
      .mockResolvedValueOnce(msg({ id: 'srv', senderId: ME, kind: 'video' }));
    await renderChat();
    await screen.findByText('Salut!');

    pickFile(new File(['vid'], 'v.mp4', { type: 'video/mp4' }));
    const sheet = await screen.findByTestId('media-preview');
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId('media-preview-send'));
    });

    expect(await screen.findByTestId('upload-error')).toHaveTextContent('50 MB');

    await act(async () => {
      fireEvent.click(screen.getByTestId('upload-retry'));
    });
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('upload-error')).not.toBeInTheDocument());
  });
});

describe('randarea mesajelor media', () => {
  beforeEach(() => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [
        msg({
          id: 'img',
          body: '',
          kind: 'image',
          attachment: { url: 'https://cdn.test/p.jpg', mime: 'image/jpeg', sizeBytes: 1, durationMs: null, width: 800, height: 600 },
        }),
        msg({
          id: 'vid',
          body: 'Uite ce am filmat',
          kind: 'video',
          attachment: { url: 'https://cdn.test/v.mp4', mime: 'video/mp4', sizeBytes: 1, durationMs: 12_000, width: null, height: null },
        }),
        msg({
          id: 'voc',
          senderId: ME,
          body: '',
          kind: 'voice',
          isRead: false,
          attachment: { url: 'https://cdn.test/a.webm', mime: 'audio/webm', sizeBytes: 1, durationMs: 7_000, width: null, height: null },
        }),
      ],
      nextCursor: null,
    });
  });

  it('poza: miniatură cu proporția din width/height, deschisă pe tot ecranul', async () => {
    await renderChat();

    const img = await screen.findByAltText('Poză');
    expect(img).toHaveAttribute('src', 'https://cdn.test/p.jpg');
    const thumb = screen.getByRole('button', { name: 'Deschide poza' });
    expect(thumb.style.aspectRatio).toBe(String(800 / 600));

    fireEvent.click(thumb);
    const viewer = screen.getByTestId('media-viewer');
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', 'https://cdn.test/p.jpg');
    fireEvent.click(within(viewer).getByRole('button', { name: 'Închide' }));
    expect(screen.queryByTestId('media-viewer')).not.toBeInTheDocument();
  });

  it('video-ul: previzualizare inline, buton play, descriere', async () => {
    await renderChat();

    expect(await screen.findByText('Uite ce am filmat')).toBeInTheDocument();
    expect(document.querySelector('video[src^="https://cdn.test/v.mp4"]')).not.toBeNull();
    expect(screen.getByText('0:12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redă video-ul' }));
    expect(screen.getByTestId('media-viewer').querySelector('video')).not.toBeNull();
  });

  it('vocalul: player cu durata, iar mesajul propriu necitit are o singură bifă', async () => {
    await renderChat();

    const player = await screen.findByTestId('voice-player');
    expect(within(player).getByRole('button', { name: 'Ascultă' })).toBeInTheDocument();
    expect(within(player).getByText('0:07')).toBeInTheDocument();
    expect(player.querySelectorAll('.voice__bar').length).toBeGreaterThan(10);
    expect(screen.getByTestId('sent-tick')).toBeInTheDocument();
  });
});

describe('aspectul firului', () => {
  it('separator „Astăzi", emoji-only mare și bifă dublă la mesajul citit', async () => {
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [msg({ id: 'e1', senderId: ME, body: '😍🔥', isRead: true })],
      nextCursor: null,
    });
    await renderChat();

    expect(await screen.findByTestId('day-separator')).toHaveTextContent('Astăzi');
    const bubble = screen.getByText('😍🔥').closest('.bubble');
    expect(bubble).toHaveClass('bubble--emoji');
    expect(screen.getByTestId('read-ticks')).toBeInTheDocument();
  });
});

describe('rândul din listă', () => {
  it('arată eticheta media tradusă când ultimul mesaj e o poză', () => {
    renderWithProviders(
      <MemoryRouter>
        <ul>
          <ChatListRow chat={{ ...CHAT, lastMessage: '', lastMessageKind: 'voice' }} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByText('🎤 Mesaj vocal')).toBeInTheDocument();
  });
});
