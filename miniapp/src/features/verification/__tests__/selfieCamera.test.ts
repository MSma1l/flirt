/**
 * Detecția camerei și captura cadrului.
 *
 * Aici stau cele două lucruri care nu se pot verifica pe un dispozitiv real
 * fără să repeți manual patru scenarii pe patru clienți Telegram:
 *  1. fiecare fel de eșec al lui `getUserMedia` produce motivul corect (de el
 *     depinde dacă mai avem voie să cerem permisiunea încă o dată);
 *  2. cadrul TRIMIS nu e oglindit, deși previzualizarea e.
 *
 * `navigator` intră ca parametru: jsdom nu are `mediaDevices`, iar un mock global
 * ar face testele să depindă de ordinea lor.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  captureFrame,
  classifyCameraError,
  isCameraSupported,
  openSelfieStream,
  probeCameraPermission,
  stopStream,
  waitForVideo,
  type CameraNavigator,
} from '../selfieCamera';

/** O eroare cu `name`, exact forma în care browserul respinge `getUserMedia`. */
function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('detecția camerei', () => {
  it('vede lipsa completă a API-ului, fără să se uite la platformă', () => {
    expect(isCameraSupported({} as CameraNavigator)).toBe(false);
    expect(isCameraSupported({ mediaDevices: {} } as CameraNavigator)).toBe(false);
    expect(
      isCameraSupported({ mediaDevices: { getUserMedia: vi.fn() } } as CameraNavigator),
    ).toBe(true);
  });

  it('întoarce „unsupported" când `getUserMedia` nu există', async () => {
    await expect(openSelfieStream({} as CameraNavigator)).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'noCamera'],
    ['DevicesNotFoundError', 'noCamera'],
    ['OverconstrainedError', 'noCamera'],
    ['NotReadableError', 'failed'],
    ['AbortError', 'failed'],
    ['CevaNemaivăzut', 'failed'],
  ])('clasifică „%s" ca „%s"', (name, expected) => {
    expect(classifyCameraError(domError(name))).toBe(expected);
  });

  it('clasifică drept „failed" și ce nu e nici măcar o eroare', () => {
    expect(classifyCameraError(undefined)).toBe('failed');
    expect(classifyCameraError('nu merge')).toBe('failed');
  });

  it('nu aruncă niciodată: excepția lui `getUserMedia` devine motiv', async () => {
    const nav = {
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(domError('NotAllowedError')) },
    } as CameraNavigator;

    await expect(openSelfieStream(nav)).resolves.toEqual({ ok: false, reason: 'denied' });
  });

  it('cere camera FRONTALĂ și fără microfon', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const nav = { mediaDevices: { getUserMedia } } as CameraNavigator;

    await expect(openSelfieStream(nav)).resolves.toEqual({ ok: true, stream });

    const constraints = getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    expect(constraints.audio).toBe(false);
    expect((constraints.video as MediaTrackConstraints).facingMode).toBe('user');
  });

  it('tratează un flux nul ca eșec, nu ca succes', async () => {
    const nav = {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(undefined) },
    } as CameraNavigator;
    await expect(openSelfieStream(nav)).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});

describe('starea permisiunii', () => {
  it('„unknown" când Permissions API lipsește (Safari/iOS)', async () => {
    await expect(probeCameraPermission({} as CameraNavigator)).resolves.toBe('unknown');
  });

  it('„denied" ne scutește de încă o cerere de permisiune', async () => {
    const nav = {
      permissions: { query: vi.fn().mockResolvedValue({ state: 'denied' }) },
    } as CameraNavigator;
    await expect(probeCameraPermission(nav)).resolves.toBe('denied');
  });

  it('„unknown" când interogarea aruncă (Firefox nu cunoaște numele „camera")', async () => {
    const nav = {
      permissions: { query: vi.fn().mockRejectedValue(new TypeError('nu')) },
    } as CameraNavigator;
    await expect(probeCameraPermission(nav)).resolves.toBe('unknown');
  });
});

describe('oprirea camerei', () => {
  it('oprește fiecare pistă a fluxului', () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;
    stopStream(stream);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('nu aruncă pe null și nici pe un flux deja închis', () => {
    expect(() => stopStream(null)).not.toThrow();
    expect(() =>
      stopStream({
        getTracks: () => {
          throw new Error('deja închis');
        },
      } as unknown as MediaStream),
    ).not.toThrow();
  });
});

describe('pornirea fluxului video', () => {
  it('„false" când elementul video raportează eroare', async () => {
    const video = document.createElement('video');
    const promise = waitForVideo(video, 50_000);
    video.dispatchEvent(new Event('error'));
    await expect(promise).resolves.toBe(false);
  });

  it('„true" când sosesc metadatele', async () => {
    const video = document.createElement('video');
    const promise = waitForVideo(video, 50_000);
    video.dispatchEvent(new Event('loadedmetadata'));
    await expect(promise).resolves.toBe(true);
  });
});

/* ——————————————————— OGLINDIREA: cerința centrală ——————————————————— */

describe('captura cadrului', () => {
  /** Un `<canvas>` fals cu context 2D observabil (jsdom nu are context real). */
  function fakeCanvas(blob: Blob | null = new Blob(['x'], { type: 'image/jpeg' })) {
    const ctx = {
      drawImage: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      transform: vi.fn(),
      setTransform: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((cb: (b: Blob | null) => void, _type?: string, _quality?: number) =>
        cb(blob),
      ),
    };
    return { canvas: canvas as unknown as HTMLCanvasElement, ctx, raw: canvas };
  }

  /** Un `<video>` fals cu dimensiuni de cadru. */
  function fakeVideo(width = 720, height = 1280): HTMLVideoElement {
    return { videoWidth: width, videoHeight: height } as unknown as HTMLVideoElement;
  }

  it('desenează cadrul NEOGLINDIT, deși previzualizarea e oglindită prin CSS', async () => {
    const { canvas, ctx, raw } = fakeCanvas();
    const video = fakeVideo();

    const blob = await captureFrame(video, { createCanvas: () => canvas });

    expect(blob).toBeInstanceOf(Blob);
    // Canvas-ul are exact dimensiunea cadrului.
    expect(raw.width).toBe(720);
    expect(raw.height).toBe(1280);
    // Cadrul e desenat întreg, de la origine, cu lățime POZITIVĂ.
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 720, 1280);
    // Și, cel mai important: NICIO transformare care ar putea răsturna imaginea.
    expect(ctx.scale).not.toHaveBeenCalled();
    expect(ctx.translate).not.toHaveBeenCalled();
    expect(ctx.transform).not.toHaveBeenCalled();
    expect(ctx.setTransform).not.toHaveBeenCalled();
  });

  it('întoarce null când cadrul nu are încă dimensiuni', async () => {
    const { canvas } = fakeCanvas();
    await expect(
      captureFrame(fakeVideo(0, 0), { createCanvas: () => canvas }),
    ).resolves.toBeNull();
  });

  it('întoarce null când contextul 2D lipsește', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
      toBlob: vi.fn(),
    } as unknown as HTMLCanvasElement;
    await expect(captureFrame(fakeVideo(), { createCanvas: () => canvas })).resolves.toBeNull();
  });

  it('cere encoderului un tip acceptat de backend', async () => {
    const { canvas, raw } = fakeCanvas();
    await captureFrame(fakeVideo(), { createCanvas: () => canvas });
    expect(raw.toBlob.mock.calls[0]?.[1]).toBe('image/jpeg');
  });
});
