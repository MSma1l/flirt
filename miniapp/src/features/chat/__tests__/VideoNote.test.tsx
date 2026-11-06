/**
 * Mesajele video rotunde („кружки") și răspunsurile la povești:
 *  - butonul de înregistrare: atingere = comută microfon ↔ cameră, ținut
 *    apăsat = înregistrează în modul curent; clicul din tastatură = vocal direct;
 *  - înregistrarea video: camera frontală, previzualizare rotundă, upload cu
 *    `kind: 'video_note'`;
 *  - bula rotundă (redare la atingere, durată) și eticheta din listă;
 *  - prefixul românesc al răspunsurilor la povești, înlocuit cu i18n.
 */
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
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
import {
  MIN_VIDEO_NOTE_MS,
  pickVideoMimeType,
  useVideoNoteRecorder,
  videoExtension,
} from '../useVideoNoteRecorder';
import { VideoNotePlayer } from '../VideoNotePlayer';

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

    // Sub o secundă înregistrarea s-ar arunca: „trecem" 5 s pe ceas.
    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + 5000);
    await act(async () => {
      fireEvent.click(screen.getByTestId('video-note-send'));
    });
    clock.mockRestore();
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalled());
    const [chatId, blob, options] = vi.mocked(uploadAttachment).mock.calls[0]!;
    expect(chatId).toBe('c1');
    expect(blob.type).toBe('video/mp4');
    expect(options).toMatchObject({ kind: 'video_note' });
    expect(options?.durationMs).toBeGreaterThanOrEqual(MIN_VIDEO_NOTE_MS);
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

/* ——— Hook-ul de înregistrare: camera se stinge MEREU ——— */

interface FakeStreamOptions {
  facingMode?: string;
}

function fakeStream({ facingMode = 'user' }: FakeStreamOptions = {}) {
  const stopTrack = vi.fn();
  const track = { stop: stopTrack, getSettings: () => ({ facingMode }) };
  const stream = {
    getTracks: () => [track, { stop: stopTrack }],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stopTrack };
}

function installGum(impl: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  return getUserMedia;
}

describe('useVideoNoteRecorder', () => {
  let created: FakeRecorder[];

  beforeEach(() => {
    created = [];
    class TrackedRecorder extends FakeRecorder {
      constructor(stream: unknown, options?: { mimeType?: string }) {
        super(stream, options);
        created.push(this);
      }
    }
    (window as unknown as Record<string, unknown>).MediaRecorder = TrackedRecorder;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('anulat cât timp se aștepta camera: fluxul sosit e oprit, nu pornește nimic', async () => {
    const { stream, stopTrack } = fakeStream();
    let deliver: (s: MediaStream) => void = () => {};
    installGum(() => new Promise<MediaStream>((resolve) => (deliver = resolve)));
    const onAuto = vi.fn();
    const { result } = renderHook(() => useVideoNoteRecorder(onAuto));

    act(() => {
      void result.current.start();
    });
    expect(result.current.status).toBe('starting');
    act(() => result.current.cancel());
    expect(result.current.status).toBe('idle');

    await act(async () => {
      deliver(stream);
      await Promise.resolve();
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(result.current.status).toBe('idle');
    expect(result.current.stream).toBeNull();
  });

  it('ecranul închis cât timp se aștepta camera: camera se stinge', async () => {
    const { stream, stopTrack } = fakeStream();
    let deliver: (s: MediaStream) => void = () => {};
    installGum(() => new Promise<MediaStream>((resolve) => (deliver = resolve)));
    const { result, unmount } = renderHook(() => useVideoNoteRecorder(vi.fn()));

    act(() => {
      void result.current.start();
    });
    unmount();
    await act(async () => {
      deliver(stream);
      await Promise.resolve();
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('ecranul închis în timpul înregistrării: camera se stinge, nimic nu se trimite', async () => {
    const { stream, stopTrack } = fakeStream();
    installGum(() => Promise.resolve(stream));
    const onAuto = vi.fn();
    const { result, unmount } = renderHook(() => useVideoNoteRecorder(onAuto));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');
    unmount();
    expect(stopTrack).toHaveBeenCalled();
    expect(created[0]!.state).toBe('inactive');
    expect(onAuto).not.toHaveBeenCalled();
  });

  it('o înregistrare sub o secundă se aruncă (dar camera se stinge)', async () => {
    const { stream, stopTrack } = fakeStream();
    installGum(() => Promise.resolve(stream));
    const { result } = renderHook(() => useVideoNoteRecorder(vi.fn()));
    await act(async () => {
      await result.current.start();
    });
    let rec: unknown = 'pending';
    await act(async () => {
      rec = await result.current.stop();
    });
    expect(rec).toBeNull();
    expect(stopTrack).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('o înregistrare normală: blob, durată, mime; camera se stinge', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const { stream, stopTrack } = fakeStream();
    installGum(() => Promise.resolve(stream));
    const { result } = renderHook(() => useVideoNoteRecorder(vi.fn()));
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(2_400);
    });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(2_000);
    let rec: { blob: Blob; durationMs: number; mime: string } | null = null;
    await act(async () => {
      rec = await result.current.stop();
    });
    expect(rec).not.toBeNull();
    expect(rec!.durationMs).toBe(2_400);
    expect(rec!.mime).toBe('video/mp4');
    expect(rec!.blob.size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalled();
  });

  it('la 60 s se oprește singură și se trimite', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const { stream, stopTrack } = fakeStream();
    installGum(() => Promise.resolve(stream));
    const onAuto = vi.fn();
    const { result } = renderHook(() => useVideoNoteRecorder(onAuto));
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(60_200);
    });
    expect(onAuto).toHaveBeenCalledTimes(1);
    expect(onAuto.mock.calls[0]![0]).toMatchObject({ durationMs: 60_000, mime: 'video/mp4' });
    expect(stopTrack).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('MediaRecorder.start aruncă: camera se stinge, eroare „indisponibil"', async () => {
    class Broken extends FakeRecorder {
      override start() {
        throw new Error('NotSupportedError');
      }
    }
    (window as unknown as Record<string, unknown>).MediaRecorder = Broken;
    const { stream, stopTrack } = fakeStream();
    installGum(() => Promise.resolve(stream));
    const { result } = renderHook(() => useVideoNoteRecorder(vi.fn()));
    await act(async () => {
      await result.current.start();
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(result.current.error).toBe('unavailable');
    expect(result.current.status).toBe('idle');
  });

  it('eroare a encoderului în timpul înregistrării: camera se stinge, nimic trimis', async () => {
    const { stream, stopTrack } = fakeStream();
    installGum(() => Promise.resolve(stream));
    const onAuto = vi.fn();
    const { result } = renderHook(() => useVideoNoteRecorder(onAuto));
    await act(async () => {
      await result.current.start();
    });
    const recorder = created[0] as unknown as { onerror: (() => void) | null };
    act(() => recorder.onerror?.());
    expect(stopTrack).toHaveBeenCalled();
    expect(onAuto).not.toHaveBeenCalled();
    expect(result.current.error).toBe('unavailable');
    expect(result.current.status).toBe('idle');
  });

  it('fără microfon (NotFoundError): a doua încercare doar cu camera', async () => {
    const { stream } = fakeStream();
    const getUserMedia = installGum((constraints) =>
      constraints.audio
        ? Promise.reject(Object.assign(new Error('no mic'), { name: 'NotFoundError' }))
        : Promise.resolve(stream),
    );
    const { result } = renderHook(() => useVideoNoteRecorder(vi.fn()));
    await act(async () => {
      await result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1]![0]).toMatchObject({
      audio: false,
      video: expect.objectContaining({ facingMode: 'user' }),
    });
    expect(result.current.status).toBe('recording');
    act(() => result.current.cancel());
  });

  it('permisiunea refuzată: „denied", fără a doua cerere', async () => {
    const getUserMedia = installGum(() =>
      Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
    );
    const { result } = renderHook(() => useVideoNoteRecorder(vi.fn()));
    await act(async () => {
      await result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('denied');
    expect(result.current.status).toBe('idle');
  });

  it('oglindirea doar pentru camera frontală efectiv primită', async () => {
    const { stream } = fakeStream({ facingMode: 'environment' });
    installGum(() => Promise.resolve(stream));
    const { result } = renderHook(() => useVideoNoteRecorder(vi.fn()));
    expect(result.current.mirrored).toBe(true);
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.mirrored).toBe(false);
    act(() => result.current.cancel());
  });
});

/* ——— Playerul: buclă fără sunet pe ecran, atingere = cu sunet ——— */

class FakeIO {
  static instances: FakeIO[] = [];
  target: Element | null = null;
  constructor(private readonly cb: IntersectionObserverCallback) {
    FakeIO.instances.push(this);
  }
  observe(el: Element) {
    this.target = el;
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  fire(visible: boolean) {
    act(() => {
      this.cb(
        [
          {
            isIntersecting: visible,
            intersectionRatio: visible ? 1 : 0,
            target: this.target,
          } as unknown as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      );
    });
  }
}

/** `<video>` minimal: `play`/`pause` schimbă `paused` și emit evenimentele. */
function fakeMediaPlayback() {
  const playingEls = new WeakSet<HTMLMediaElement>();
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return !playingEls.has(this);
  });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (!playingEls.has(this)) {
      playingEls.add(this);
      this.dispatchEvent(new Event('play'));
    }
    return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (playingEls.has(this)) {
      playingEls.delete(this);
      this.dispatchEvent(new Event('pause'));
    }
  });
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  return { play, pause, load };
}

function renderNotes(count = 1) {
  return renderWithProviders(
    <div>
      {Array.from({ length: count }, (_, i) => (
        <VideoNotePlayer key={i} src={`https://cdn.test/n${i}.mp4`} durationMs={15_000} />
      ))}
    </div>,
  );
}

describe('VideoNotePlayer', () => {
  beforeEach(() => {
    FakeIO.instances = [];
    (window as unknown as Record<string, unknown>).IntersectionObserver = FakeIO;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).IntersectionObserver;
    vi.restoreAllMocks();
  });

  it('pe ecran: buclă fără sunet; în afara ecranului: pauză', () => {
    const { play, pause } = fakeMediaPlayback();
    renderNotes();
    const note = screen.getByTestId('video-note');
    const video = note.querySelector('video')!;
    expect(video).toHaveAttribute('playsinline');
    expect(note).toHaveAttribute('data-state', 'idle');

    FakeIO.instances[0]!.fire(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(note).toHaveAttribute('data-state', 'preview');
    expect(note).toHaveAttribute('aria-pressed', 'false');

    FakeIO.instances[0]!.fire(false);
    expect(pause).toHaveBeenCalled();
    expect(note).toHaveAttribute('data-state', 'idle');
  });

  it('atingerea: de la început, cu sunet și inel; la final revine în buclă', () => {
    fakeMediaPlayback();
    renderNotes();
    const note = screen.getByTestId('video-note');
    const video = note.querySelector('video')!;
    FakeIO.instances[0]!.fire(true);

    fireEvent.click(note);
    expect(video.muted).toBe(false);
    expect(video.loop).toBe(false);
    expect(note).toHaveAttribute('data-state', 'sound');
    expect(note).toHaveAttribute('aria-pressed', 'true');
    expect(note).toHaveAccessibleName('Pune pe pauză mesajul video');
    expect(note.querySelector('.video-note__ring')).not.toBeNull();

    // A doua atingere: pauză (rămâne în modul cu sunet).
    fireEvent.click(note);
    expect(note).toHaveAttribute('data-state', 'paused');

    fireEvent.click(note);
    expect(note).toHaveAttribute('data-state', 'sound');
    fireEvent(video, new Event('ended'));
    expect(note).toHaveAttribute('data-state', 'preview');
    expect(video.muted).toBe(true);
    expect(note.querySelector('.video-note__ring')).toBeNull();
  });

  it('un singur mesaj cu sunet: al doilea (sau un vocal) îl oprește pe primul', () => {
    fakeMediaPlayback();
    renderNotes(2);
    const [first, second] = screen.getAllByTestId('video-note');
    FakeIO.instances.forEach((io) => io.fire(true));

    fireEvent.click(first!);
    expect(first).toHaveAttribute('data-state', 'sound');
    fireEvent.click(second!);
    expect(second).toHaveAttribute('data-state', 'sound');
    expect(first).toHaveAttribute('data-state', 'preview');
    expect(first!.querySelector('video')!.muted).toBe(true);

    // Un vocal pornit în pagină → și „кружок"-ul cu sunet revine în buclă.
    const audio = document.createElement('audio');
    document.body.appendChild(audio);
    act(() => {
      audio.dispatchEvent(new Event('play'));
    });
    expect(second).toHaveAttribute('data-state', 'preview');
    audio.remove();
  });

  it('cu sunet și ieșit de pe ecran: pauză', () => {
    const { pause } = fakeMediaPlayback();
    renderNotes();
    const note = screen.getByTestId('video-note');
    FakeIO.instances[0]!.fire(true);
    fireEvent.click(note);
    FakeIO.instances[0]!.fire(false);
    expect(pause).toHaveBeenCalled();
    expect(note).toHaveAttribute('data-state', 'paused');
  });

  it('play() întrerupt (AbortError) nu e o eroare a fișierului', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
      Promise.reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })),
    );
    renderNotes();
    fireEvent.click(screen.getByTestId('video-note'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('format neredabil: mesaj clar, fără buclă; atingerea reîncearcă cu load()', () => {
    const { play, load } = fakeMediaPlayback();
    renderNotes();
    const note = screen.getByTestId('video-note');
    const video = note.querySelector('video')!;
    fireEvent.error(video);
    expect(note).toHaveAttribute('data-state', 'failed');
    expect(screen.getByRole('alert')).toHaveTextContent(/nu poate fi redat/i);

    FakeIO.instances[0]!.fire(true);
    expect(play).not.toHaveBeenCalled();

    fireEvent.click(note);
    expect(load).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('bula optimistă (upload în curs): fără redare și fără eroare', () => {
    const { play } = fakeMediaPlayback();
    renderWithProviders(<VideoNotePlayer src="blob:local" durationMs={3_000} disabled />);
    const note = screen.getByTestId('video-note');
    FakeIO.instances[0]!.fire(true);
    fireEvent.error(note.querySelector('video')!);
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
