/**
 * Micșorarea pozei ÎNAINTE de a pleca spre `POST /stories/media`.
 *
 * Regula apărată aici: nimic nu pleacă peste `max_upload_bytes` (8 MB), iar ce
 * nu poate fi trimis produce un mesaj pe care utilizatorul îl poate folosi.
 * Decodarea și encodarea sunt injectate — jsdom nu are nici `createImageBitmap`,
 * nici `canvas.toBlob`, iar ce contează e bucla de trepte, nu encoderul.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  formatMb,
  prepareStoryImage,
  scaleToFit,
  STORY_COMPRESSION,
  STORY_IMAGE_LIMITS,
  type ResizeIo,
} from '../imageResize';

const LIMITS = {
  maxUploadBytes: STORY_IMAGE_LIMITS.maxUploadBytes,
  allowedTypes: STORY_IMAGE_LIMITS.allowedTypes,
};
const COMPRESSION = {
  dimensions: STORY_COMPRESSION.dimensions,
  qualities: STORY_COMPRESSION.qualities,
  outputType: STORY_COMPRESSION.outputType,
};

/** Un fișier fals: ne interesează doar mărimea și tipul. */
function fakeFile(size: number, type = 'image/jpeg'): File {
  return { size, type } as File;
}

/**
 * Encoder fals: mărimea crește cu numărul de pixeli și cu calitatea, exact ca
 * un JPEG real. `factor` reglează cât de „grea" e poza.
 */
function fakeIo(width: number, height: number, factor: number) {
  const encode = vi.fn(
    async (_img: { width: number; height: number }, w: number, h: number, q: number) =>
      ({ size: Math.round(w * h * q * factor) }) as Blob,
  );
  const io: ResizeIo<{ width: number; height: number }> = {
    decode: vi.fn(async () => ({ width, height })),
    encode,
    release: vi.fn(),
  };
  return { io, encode };
}

describe('scaleToFit', () => {
  it('aduce latura mare la limită și păstrează proporția', () => {
    expect(scaleToFit(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 });
    expect(scaleToFit(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 });
  });

  it('NU mărește niciodată o poză mai mică decât ținta', () => {
    expect(scaleToFit(800, 600, 1920)).toEqual({ width: 800, height: 600 });
  });
});

describe('micșorarea în trepte', () => {
  it('coboară poza sub limita serverului', async () => {
    const { io } = fakeIo(4000, 3000, 3);

    const result = await prepareStoryImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.size).toBeLessThanOrEqual(LIMITS.maxUploadBytes);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1920);
    expect(result.fileName.endsWith('.jpg')).toBe(true);
  });

  it('scade întâi calitatea, apoi dimensiunea', async () => {
    // Cu `factor = 8`, nicio calitate nu intră la 1920px; abia 1440px reușește.
    const { io, encode } = fakeIo(4000, 3000, 8);

    const result = await prepareStoryImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.width).toBe(1440);
    expect(result.height).toBe(1080);
    // 4 încercări la 1920 + 3 la 1440 (a treia intră sub limită).
    expect(encode).toHaveBeenCalledTimes(7);
    // Prima încercare pleacă de la cea mai bună calitate, nu de la cea mai mică.
    expect(encode.mock.calls[0]?.[3]).toBe(0.8);
  });

  it('se oprește la PRIMA variantă care intră sub limită', async () => {
    const { io, encode } = fakeIo(4000, 3000, 1);

    const result = await prepareStoryImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('o poză deja mică și într-un format acceptat pleacă NEATINSĂ', async () => {
    const { io, encode } = fakeIo(800, 600, 1);
    const file = fakeFile(120_000, 'image/jpeg');

    const result = await prepareStoryImage(file, io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob).toBe(file);
    expect(encode).not.toHaveBeenCalled();
  });

  it('eliberează imaginea decodată chiar și când nu reușește', async () => {
    const { io } = fakeIo(4000, 3000, 1000);

    await prepareStoryImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(io.release).toHaveBeenCalledTimes(1);
  });
});

describe('fișiere pe care nu le putem trimite', () => {
  it('respinge ce nu e imagine, fără să încerce măcar decodarea', async () => {
    const { io } = fakeIo(10, 10, 1);

    const result = await prepareStoryImage(
      fakeFile(1000, 'application/pdf'),
      io,
      LIMITS,
      COMPRESSION,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('type');
    expect(result.message).toContain('poză');
    expect(io.decode).not.toHaveBeenCalled();
  });

  it('respinge un video ales din galerie, fiindcă backendul îl refuză oricum', async () => {
    const { io } = fakeIo(10, 10, 1);

    const result = await prepareStoryImage(
      fakeFile(40_000_000, 'video/mp4'),
      io,
      LIMITS,
      COMPRESSION,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('type');
    expect(io.decode).not.toHaveBeenCalled();
  });

  it('spune CLAR când poza nu intră sub limită nici la ultima treaptă', async () => {
    const { io } = fakeIo(4000, 3000, 1000);

    const result = await prepareStoryImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('tooLarge');
    // Mesajul spune cât are poza (ultima treaptă: 720px, calitate 0.5) și care
    // e limita — altfel „prea mare" nu ajută pe nimeni.
    expect(result.message).toContain(formatMb(Math.round(720 * 540 * 0.5 * 1000)));
    expect(result.message).toContain(formatMb(LIMITS.maxUploadBytes));
  });

  it('o poză pe care browserul nu o poate citi (HEIC) dă un mesaj, nu o excepție', async () => {
    const io: ResizeIo<{ width: number; height: number }> = {
      decode: vi.fn(async () => {
        throw new Error('format necunoscut');
      }),
      encode: vi.fn(),
    };

    const result = await prepareStoryImage(fakeFile(3_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('decode');
    expect(result.message).toContain('HEIC');
  });

  it('encoderul indisponibil nu trece drept succes', async () => {
    const io: ResizeIo<{ width: number; height: number }> = {
      decode: vi.fn(async () => ({ width: 4000, height: 3000 })),
      encode: vi.fn(async () => null),
    };

    const result = await prepareStoryImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('decode');
  });
});

describe('limitele', () => {
  it('oglindesc exact configul backendului', () => {
    expect(STORY_IMAGE_LIMITS.maxUploadBytes).toBe(8_388_608);
    expect(STORY_IMAGE_LIMITS.allowedTypes).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    // Ieșirea e mereu JPEG: e în allowlist și comprimă cel mai bine.
    expect(STORY_COMPRESSION.outputType).toBe('image/jpeg');
  });

  it('formatMb taie zecimala inutilă', () => {
    expect(formatMb(8_388_608)).toBe('8 MB');
    expect(formatMb(1_572_864)).toBe('1.5 MB');
  });
});
