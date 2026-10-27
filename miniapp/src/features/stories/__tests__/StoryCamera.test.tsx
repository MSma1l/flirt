import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

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

  it('fără acces la cameră, declanșatorul deschide camera NATIVĂ', async () => {
    getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    const onNativeCamera = vi.fn();

    render(
      <StoryCamera
        onCapture={vi.fn()}
        onPickGallery={vi.fn()}
        onNativeCamera={onNativeCamera}
        onClose={vi.fn()}
      />,
    );

    const shutter = screen.getByTestId('story-camera-shutter');
    await waitFor(() => expect(shutter).toBeEnabled());
    fireEvent.click(shutter);
    expect(onNativeCamera).toHaveBeenCalledTimes(1);
  });

  it('butonul de galerie cheamă galeria, nu camera', async () => {
    getUserMedia.mockReturnValue(new Promise(() => undefined));
    const onPickGallery = vi.fn();

    render(<StoryCamera onCapture={vi.fn()} onPickGallery={onPickGallery} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('story-camera-gallery'));
    expect(onPickGallery).toHaveBeenCalledTimes(1);
  });

  describe('oglindirea camerei frontale', () => {
    function streamWithFacing(facingMode?: string) {
      const track = { stop: vi.fn(), getSettings: () => (facingMode ? { facingMode } : {}) };
      return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    }

    it('previzualizarea camerei frontale e oglindită (ca într-o aplicație de cameră)', async () => {
      getUserMedia.mockResolvedValue(streamWithFacing('user'));
      render(<StoryCamera onCapture={vi.fn()} onPickGallery={vi.fn()} onClose={vi.fn()} />);

      const video = screen.getByTestId('story-camera-video');
      await waitFor(() => expect(video).toHaveProperty('hidden', false));
      expect(video).toHaveClass('st-camera__video--mirrored');
    });

    it('camera din spate (raportată de flux) NU e oglindită', async () => {
      getUserMedia.mockResolvedValue(streamWithFacing('environment'));
      render(<StoryCamera onCapture={vi.fn()} onPickGallery={vi.fn()} onClose={vi.fn()} />);

      const video = screen.getByTestId('story-camera-video');
      await waitFor(() => expect(video).toHaveProperty('hidden', false));
      expect(video).not.toHaveClass('st-camera__video--mirrored');
    });

    it('poza CAPTURATĂ nu e oglindită: cadrul se desenează fără nicio transformare', async () => {
      getUserMedia.mockResolvedValue(streamWithFacing('user'));
      const context = {
        drawImage: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        setTransform: vi.fn(),
        transform: vi.fn(),
      };
      const getContext = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(context as unknown as CanvasRenderingContext2D);
      const toBlob = vi
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((callback: BlobCallback) =>
          callback(new Blob(['jpg'], { type: 'image/jpeg' })),
        );
      const onCapture = vi.fn();

      render(<StoryCamera onCapture={onCapture} onPickGallery={vi.fn()} onClose={vi.fn()} />);
      const video = screen.getByTestId('story-camera-video') as HTMLVideoElement;
      await waitFor(() => expect(video).toHaveProperty('hidden', false));
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });

      fireEvent.click(screen.getByTestId('story-camera-shutter'));

      expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 480);
      expect(context.scale).not.toHaveBeenCalled();
      expect(context.translate).not.toHaveBeenCalled();
      expect(context.setTransform).not.toHaveBeenCalled();
      expect(context.transform).not.toHaveBeenCalled();
      expect(onCapture).toHaveBeenCalledTimes(1);
      expect((onCapture.mock.calls[0]![0] as File).type).toBe('image/jpeg');

      getContext.mockRestore();
      toBlob.mockRestore();
    });
  });

  describe('zoom', () => {
    function zoomStream(caps?: unknown) {
      const applyConstraints = vi.fn(() => Promise.resolve());
      const track = {
        stop: vi.fn(),
        getSettings: () => ({ facingMode: 'user' }),
        ...(caps ? { getCapabilities: () => caps } : {}),
        applyConstraints,
      };
      const stream = {
        getTracks: () => [track],
        getVideoTracks: () => [track],
      } as unknown as MediaStream;
      return { stream, applyConstraints };
    }

    function mockCanvas() {
      const context = { drawImage: vi.fn() };
      const getContext = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(context as unknown as CanvasRenderingContext2D);
      const toBlob = vi
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((callback: BlobCallback) =>
          callback(new Blob(['jpg'], { type: 'image/jpeg' })),
        );
      return {
        context,
        restore: () => {
          getContext.mockRestore();
          toBlob.mockRestore();
        },
      };
    }

    async function renderReady(stream: MediaStream, onCapture = vi.fn()) {
      getUserMedia.mockResolvedValue(stream);
      render(<StoryCamera onCapture={onCapture} onPickGallery={vi.fn()} onClose={vi.fn()} />);
      const video = screen.getByTestId('story-camera-video') as HTMLVideoElement;
      await waitFor(() => expect(video).toHaveProperty('hidden', false));
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
      return video;
    }

    it('fără zoom hardware: 2× mărește previzualizarea (CSS) și decupează centrul la captură', async () => {
      const { stream } = zoomStream();
      const onCapture = vi.fn();
      const video = await renderReady(stream, onCapture);
      expect(video.dataset.zoomMode).toBe('digital');

      fireEvent.click(screen.getByTestId('story-camera-zoom-2'));
      // Camera frontală: rămâne oglindită + mărită.
      expect(video.style.transform).toBe('scale(-2, 2)');
      expect(video).toHaveClass('st-camera__video--mirrored');

      const canvas = mockCanvas();
      fireEvent.click(screen.getByTestId('story-camera-shutter'));
      // Regiunea centrală (jumătate din fiecare latură), FĂRĂ oglindire.
      expect(canvas.context.drawImage).toHaveBeenCalledWith(video, 320, 180, 640, 360, 0, 0, 640, 360);
      expect(onCapture).toHaveBeenCalledTimes(1);
      canvas.restore();
    });

    it('pinch cu două degete schimbă zoom-ul proporțional', async () => {
      const { stream } = zoomStream();
      const video = await renderReady(stream);
      const section = video.closest('section')!;

      fireEvent.touchStart(section, {
        touches: [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 100 },
        ],
      });
      fireEvent.touchMove(section, {
        touches: [
          { clientX: 50, clientY: 100 },
          { clientX: 200, clientY: 100 },
        ],
      });
      expect(video.dataset.zoom).toBe('1.5');
      expect(screen.getByTestId('story-camera-zoom-1')).toHaveTextContent('1.5');

      fireEvent.touchEnd(section, { touches: [] });
      // După gest, o singură atingere nu mai schimbă nimic.
      fireEvent.touchMove(section, { touches: [{ clientX: 0, clientY: 0 }] });
      expect(video.dataset.zoom).toBe('1.5');
    });

    it('cu zoom hardware: folosește applyConstraints și capturează cadrul întreg', async () => {
      const { stream, applyConstraints } = zoomStream({ zoom: { min: 1, max: 5, step: 0.1 } });
      const video = await renderReady(stream);
      expect(video.dataset.zoomMode).toBe('hardware');

      fireEvent.click(screen.getByTestId('story-camera-zoom-3'));
      expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 3 }] });
      // Previzualizarea NU se scalează în CSS: cadrele vin deja mărite.
      expect(video.style.transform).toBe('scaleX(-1)');

      const canvas = mockCanvas();
      fireEvent.click(screen.getByTestId('story-camera-shutter'));
      expect(canvas.context.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
      canvas.restore();
    });

    it('dacă camera refuză zoom-ul hardware, trece pe zoom digital', async () => {
      const { stream, applyConstraints } = zoomStream({ zoom: { min: 1, max: 5, step: 0.1 } });
      applyConstraints.mockRejectedValueOnce(new Error('OverconstrainedError'));
      const video = await renderReady(stream);

      fireEvent.click(screen.getByTestId('story-camera-zoom-2'));
      await waitFor(() => expect(video.dataset.zoomMode).toBe('digital'));
      expect(video.style.transform).toBe('scale(-2, 2)');
    });
  });
});
