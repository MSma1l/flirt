import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryCamera } from '../StoryCamera';

function fakeStream() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], track } as unknown as MediaStream & {
    track: { stop: ReturnType<typeof vi.fn> };
  };
}

describe('StoryCamera', () => {
  const play = vi.fn(() => Promise.resolve());
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: play,
    });
  });

  afterEach(() => {
    play.mockClear();
  });

  it('leagă fluxul camerei de video și pornește redarea (altfel ecranul e negru)', async () => {
    const stream = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    render(<StoryCamera onCapture={vi.fn()} onPickGallery={vi.fn()} onClose={vi.fn()} />);

    const video = screen.getByTestId('story-camera-video') as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).toBe(stream));
    expect(play).toHaveBeenCalled();
    expect(video.hidden).toBe(false);
  });

  it('cât se încarcă nu spune că camera e indisponibilă', () => {
    getUserMedia.mockReturnValue(new Promise(() => undefined));

    render(<StoryCamera onCapture={vi.fn()} onPickGallery={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId('story-camera-video')).toHaveProperty('hidden', true);
    expect(document.querySelector('.st-camera__notice')).toBeNull();
  });

  it('fără acces la cameră arată mesajul, iar galeria rămâne disponibilă', async () => {
    getUserMedia.mockRejectedValue(new Error('NotAllowedError'));

    render(<StoryCamera onCapture={vi.fn()} onPickGallery={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('.st-camera__notice')).not.toBeNull());
    expect(screen.getByTestId('story-camera-video')).toHaveProperty('hidden', true);
  });
});
