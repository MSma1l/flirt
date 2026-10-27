/**
 * Playerul de vocale: redare din gestul utilizatorului, sesiunea audio iOS,
 * stările de eroare (format vs rețea), reîncercarea și plafonul de așteptare.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/harness';

import {
  VOICE_STALL_MS,
  VoicePlayer,
  failureKind,
  preparePlaybackSession,
} from '../VoicePlayer';

const SRC = 'https://api.test/media/chat-media/c1/abc.m4a';

function audioEl(): HTMLAudioElement {
  return screen.getByTestId('voice-player').querySelector('audio')!;
}

describe('VoicePlayer', () => {
  let play: ReturnType<typeof vi.fn>;
  let load: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    play = vi.fn(() => Promise.resolve());
    load = vi.fn();
    pause = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
    Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: load });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (navigator as { audioSession?: unknown }).audioSession;
  });

  it('play() se cheamă SINCRON din click (iOS cere gestul utilizatorului)', async () => {
    renderWithProviders(<VoicePlayer id="m1" src={SRC} durationMs={4000} own={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('voice-player')).toHaveAttribute('data-state', 'loading');
    await act(async () => undefined);
    expect(screen.getByTestId('voice-player')).toHaveAttribute('data-state', 'idle');
  });

  it('pune sesiunea audio iOS pe „playback" (se aude și pe silențios)', async () => {
    const session = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session });
    renderWithProviders(<VoicePlayer id="m1" src={SRC} durationMs={4000} own={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(session.type).toBe('playback');
    await act(async () => undefined);
  });

  it('preparePlaybackSession nu aruncă fără API sau cu API blocat', () => {
    expect(() => preparePlaybackSession({} as Navigator)).not.toThrow();
    const locked = {};
    Object.defineProperty(locked, 'type', {
      get: () => 'auto',
      set: () => {
        throw new Error('blocked');
      },
    });
    expect(() => preparePlaybackSession({ audioSession: locked } as unknown as Navigator)).not.toThrow();
  });

  it('failureKind: decodare/format vs rețea', () => {
    expect(failureKind({ code: 4 })).toBe('format');
    expect(failureKind({ code: 3 })).toBe('format');
    expect(failureKind({ code: 2 })).toBe('network');
    expect(failureKind(null)).toBe('format');
  });

  it('formatul nesuportat arată eroarea, iar reîncercarea reîncarcă fișierul', async () => {
    renderWithProviders(<VoicePlayer id="m1" src={SRC} durationMs={4000} own={false} />);
    const audio = audioEl();
    Object.defineProperty(audio, 'error', { configurable: true, value: { code: 4 } });
    fireEvent.error(audio);

    const player = screen.getByTestId('voice-player');
    expect(player).toHaveAttribute('data-state', 'error');
    expect(player).toHaveAttribute('data-failure', 'format');
    expect(screen.getByTestId('voice-play-error')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
  });

  it('play() respins cu NotSupportedError → eroare de format', async () => {
    play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotSupportedError' })));
    renderWithProviders(<VoicePlayer id="m1" src={SRC} durationMs={4000} own={false} />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => undefined);
    expect(screen.getByTestId('voice-player')).toHaveAttribute('data-failure', 'format');
  });

  it('AbortError (alt vocal pornit) NU e o eroare', async () => {
    play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })));
    renderWithProviders(<VoicePlayer id="m1" src={SRC} durationMs={4000} own={false} />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => undefined);
    expect(screen.getByTestId('voice-player')).toHaveAttribute('data-state', 'idle');
  });

  it('redarea blocată fără niciun eveniment → eroare de rețea după plafon', () => {
    vi.useFakeTimers();
    play.mockImplementation(() => new Promise(() => undefined)); // nu se rezolvă niciodată
    renderWithProviders(<VoicePlayer id="m1" src={SRC} durationMs={4000} own={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('voice-player')).toHaveAttribute('data-state', 'loading');

    act(() => {
      vi.advanceTimersByTime(VOICE_STALL_MS + 10);
    });
    const player = screen.getByTestId('voice-player');
    expect(player).toHaveAttribute('data-state', 'error');
    expect(player).toHaveAttribute('data-failure', 'network');
    expect(pause).toHaveBeenCalled();
  });

  it('pornirea redării (`playing`) anulează plafonul', () => {
    vi.useFakeTimers();
    play.mockImplementation(() => new Promise(() => undefined));
    renderWithProviders(<VoicePlayer id="m1" src={SRC} durationMs={4000} own={false} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent(audioEl(), new Event('playing'));

    act(() => {
      vi.advanceTimersByTime(VOICE_STALL_MS + 10);
    });
    expect(screen.getByTestId('voice-player')).toHaveAttribute('data-state', 'idle');
  });
});
