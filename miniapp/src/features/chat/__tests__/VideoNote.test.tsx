/**
 * Mesajele video rotunde („кружки") și răspunsurile la povești:
 *  - butonul de înregistrare: atingere = comută microfon ↔ cameră, ținut
 *    apăsat = înregistrează în modul curent; clicul din tastatură = vocal direct;
 *  - înregistrarea video: camera frontală, previzualizare rotundă, upload cu
 *    `kind: 'video_note'`;
 *  - bula rotundă (redare la atingere, durată) și eticheta din listă;
 *  - prefixul românesc al răspunsurilor la povești, înlocuit cu i18n.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/authStore';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/harness';

import type { ChatMessageEx, ChatSummaryEx } from '../chatApi';
import { HOLD_TO_RECORD_MS } from '../ChatComposer';
import { ChatListRow } from '../ChatListRow';
import { ChatScreen } from '../ChatScreen';
import { CHAT_ROUTE_PATTERN, chatPath } from '../chatRoutes';
import { STORY_REPLY_SERVER_PREFIX, splitStoryReply } from '../storyReply';
import { pickVideoMimeType, videoExtension } from '../useVideoNoteRecorder';

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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `MediaRecorder` minimal: la `stop()` livrează un chunk și cheamă `onstop`. */
class FakeRecorder {
  static isTypeSupported(mime: string) {
    return mime === 'video/mp4' || mime.startsWith('audio/');
  }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['frames'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function installMedia() {
  (window as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  return { getUserMedia, stopTrack };
}

/** Atingere scurtă pe butonul de înregistrare (sub pragul de apăsare lungă). */
function tap(button: HTMLElement) {
  fireEvent.pointerDown(button, { pointerType: 'touch', button: 0 });
  fireEvent.pointerUp(button, { pointerType: 'touch', button: 0 });
  fireEvent.click(button, { detail: 1 });
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: ME, email: 'me@test.local', profile_completed: true },
    error: null,
  });
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

describe('butonul de înregistrare: microfon ↔ cameră', () => {
  it('o atingere scurtă comută modul și arată indiciul, fără să înregistreze', async () => {
    const { getUserMedia } = installMedia();
    await renderChat();
    await screen.findByText('Salut!');

    const button = screen.getByTestId('mic-button');
    expect(button).toHaveAttribute('data-mode', 'voice');

    tap(button);
    expect(button).toHaveAttribute('data-mode', 'video');
    expect(button).toHaveAccessibleName('Înregistrează un mesaj video');
    expect(screen.getByTestId('record-hint')).toHaveTextContent('Ține apăsat');

    tap(button);
    expect(button).toHaveAttribute('data-mode', 'voice');
    expect(button).toHaveAccessibleName('Înregistrează un mesaj vocal');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('clicul din tastatură înregistrează direct în modul curent (vocal)', async () => {
    const { getUserMedia } = installMedia();
    await renderChat();
    await screen.findByText('Salut!');

    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(await screen.findByTestId('voice-recorder')).toBeInTheDocument();
  });

  it('ținut apăsat în modul cameră: previzualizare rotundă, apoi upload ca video_note', async () => {
    const { getUserMedia, stopTrack } = installMedia();
    // jsdom nu implementează redarea (previzualizarea camerei o pornește).
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    vi.mocked(uploadAttachment).mockImplementation(() => new Promise(() => {}));
    await renderChat();
    await screen.findByText('Salut!');

    const button = screen.getByTestId('mic-button');
    tap(button);
    expect(button).toHaveAttribute('data-mode', 'video');

    fireEvent.pointerDown(button, { pointerType: 'touch', button: 0 });
    await act(async () => {
      await wait(HOLD_TO_RECORD_MS + 50);
    });
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: true,
        video: expect.objectContaining({ facingMode: 'user' }),
      }),
    );
    expect(await screen.findByTestId('video-note-preview')).toBeInTheDocument();
    expect(screen.getByTestId('video-note-recorder')).toBeInTheDocument();

    // Degetul se ridică: înregistrarea rămâne pornită (blocată), nu se trimite.
    fireEvent.pointerUp(window);
    expect(uploadAttachment).not.toHaveBeenCalled();
    await act(async () => {
      await wait(450);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('video-note-send'));
    });
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalled());
    const [chatId, blob, options] = vi.mocked(uploadAttachment).mock.calls[0]!;
    expect(chatId).toBe('c1');
    expect(blob.type).toBe('video/mp4');
    expect(options).toMatchObject({ kind: 'video_note' });
    expect(options?.fileName).toMatch(/^video-note-\d+\.mp4$/);
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.queryByTestId('video-note-preview')).not.toBeInTheDocument();
    // Bula optimistă e deja rotundă.
    expect(document.querySelector('[data-kind="video_note"]')).not.toBeNull();
    play.mockRestore();
  });

  it('camera refuzată: mesaj tradus despre cameră', async () => {
    installMedia();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      Object.assign(new Error('no'), { name: 'NotAllowedError' }),
    );
    await renderChat();
    await screen.findByText('Salut!');

    const button = screen.getByTestId('mic-button');
    tap(button);
    fireEvent.pointerDown(button, { pointerType: 'touch', button: 0 });
    await act(async () => {
      await wait(HOLD_TO_RECORD_MS + 50);
    });
    expect(await screen.findByTestId('voice-error')).toHaveTextContent('cameră');
  });
});

describe('bula rotundă', () => {
  it('cerc cu durata; atingerea pornește redarea cu sunet', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    vi.mocked(fetchMessagesPage).mockResolvedValue({
      items: [
        msg({
          id: 'vn',
          body: '',
          kind: 'video_note',
          attachment: {
            url: 'https://cdn.test/n.mp4',
            mime: 'video/mp4',
            sizeBytes: 1,
            durationMs: 15_000,
            width: 480,
            height: 480,
          },
        }),
      ],
      nextCursor: null,
    });
    await renderChat();

    const note = await screen.findByTestId('video-note');
    expect(note).toHaveAccessibleName('Redă mesajul video');
    expect(screen.getByTestId('video-note-duration')).toHaveTextContent('0:15');
    const video = note.querySelector('video')!;
    expect(video.getAttribute('src')).toMatch(/^https:\/\/cdn\.test\/n\.mp4/);

    fireEvent.click(note);
    expect(play).toHaveBeenCalled();
    expect(video.muted).toBe(false);
    play.mockRestore();
  });

  it('lista: eticheta „Mesaj video" pentru ultimul mesaj video rotund', () => {
    renderWithProviders(
      <MemoryRouter>
        <ul>
          <ChatListRow chat={{ ...CHAT, lastMessage: '', lastMessageKind: 'video_note' }} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByText('📹 Mesaj video')).toBeInTheDocument();
  });
});

describe('formatul înregistrării', () => {
  it('alege MP4 când e suportat și dă extensia potrivită', () => {
    (window as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
    expect(pickVideoMimeType()).toBe('video/mp4');
    expect(videoExtension('video/mp4;codecs=avc1')).toBe('mp4');
    expect(videoExtension('video/webm;codecs=vp8,opus')).toBe('webm');
  });
});

describe('răspunsurile la povești', () => {
  const REPLY = `${STORY_REPLY_SERVER_PREFIX}Ce frumos!`;

  it('recunoaște prefixul serverului (și fără selectorul de variantă)', () => {
    expect(splitStoryReply(REPLY)).toBe('Ce frumos!');
    expect(splitStoryReply('↩ A răspuns la povestea ta: hey')).toBe('hey');
    expect(splitStoryReply('Salut')).toBeNull();
    expect(splitStoryReply('')).toBeNull();
  });

  it('în rusă: bula și lista arată eticheta tradusă, nu româna', async () => {
    const initial = i18n.language;
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    try {
      vi.mocked(fetchMessagesPage).mockResolvedValue({
        items: [
          msg({ id: 's1', body: REPLY }),
          msg({ id: 's2', senderId: ME, body: `${STORY_REPLY_SERVER_PREFIX}Спасибо` }),
        ],
        nextCursor: null,
      });
      await renderChat();

      expect(await screen.findByText('Ce frumos!')).toBeInTheDocument();
      const labels = screen.getAllByTestId('story-reply-label');
      expect(labels.map((l) => l.textContent)).toEqual([
        '↩️ Ответ на вашу историю',
        '↩️ Вы ответили на историю',
      ]);
      expect(document.body.textContent).not.toContain('A răspuns la povestea ta');

      renderWithProviders(
        <MemoryRouter>
          <ul>
            <ChatListRow chat={{ ...CHAT, lastMessage: REPLY, lastMessageKind: 'text' }} />
          </ul>
        </MemoryRouter>,
      );
      expect(screen.getByText('↩️ Ответ на историю: Ce frumos!')).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage(initial);
      });
    }
  });
});
