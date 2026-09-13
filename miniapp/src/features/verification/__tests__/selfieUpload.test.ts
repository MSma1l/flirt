/**
 * Micșorarea selfie-ului sub limita serverului.
 *
 * Bucla de trepte e testată deja în `features/onboarding/__tests__` — aici
 * verificăm exact ce adaugă modulul nostru: că un selfie de telefon CHIAR
 * coboară sub `max_upload_bytes` înainte să plece, și că fiecare fel de eșec
 * ajunge la motivul pe care ecranul îl știe afișa.
 *
 * `CompressIo` e injectat: jsdom nu are nici `createImageBitmap`, nici
 * `canvas.toBlob`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { CompressIo, DecodedImage } from '@/features/onboarding/imageCompress';

import { prepareSelfie } from '../selfieUpload';

/** Limita reală a backendului (`config.py`: `max_upload_bytes = 8_388_608`). */
const LIMITS = {
  maxUploadBytes: 8_388_608,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
};

/** Antetul unui JPEG real — pe el se uită și backendul (magic-bytes). */
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];

/**
 * Un fișier fals: mărimea și eticheta sunt separate de conținut, iar `slice()`
 * întoarce antetul. jsdom nu implementează `Blob.arrayBuffer`, deci un `Blob`
 * adevărat n-ar lăsa detecția de tip să funcționeze (același tipar ca în
 * `features/onboarding/__tests__/imageCompress.test.ts`).
 */
function blobOfSize(size: number, type = 'image/jpeg', magic = JPEG_MAGIC): Blob {
  const head = new Uint8Array(magic);
  return {
    size,
    type,
    slice: () => ({ arrayBuffer: async () => head.buffer }) as unknown as Blob,
  } as unknown as Blob;
}

/**
 * Un selfie „de telefon": 4032×3024, peste limită. Encoderul fals întoarce un
 * blob a cărui mărime scade odată cu dimensiunea și calitatea — exact relația
 * pe care se bazează bucla reală.
 */
function phoneSelfieIo(): CompressIo<DecodedImage> {
  return {
    decode: vi.fn(async () => ({ width: 4032, height: 3024 })),
    encode: vi.fn(async (_image, width, _height, quality) =>
      blobOfSize(Math.round(width * 6000 * quality)),
    ),
  };
}

describe('pregătirea selfie-ului', () => {
  it('coboară o poză de telefon sub limita serverului', async () => {
    // 12 MB la intrare: peste `max_upload_bytes`, deci serverul ar da 413.
    const file = blobOfSize(12 * 1024 * 1024);

    const result = await prepareSelfie(file, phoneSelfieIo(), LIMITS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.size).toBeLessThanOrEqual(LIMITS.maxUploadBytes);
    expect(result.fileName).toMatch(/\.jpg$/);
  });

  it('nu re-encodează degeaba o poză care intră deja în limită', async () => {
    const io: CompressIo<DecodedImage> = {
      decode: vi.fn(async () => ({ width: 1080, height: 1080 })),
      encode: vi.fn(async () => blobOfSize(1000)),
    };
    // JPEG real (magic-bytes FF D8 FF) și mic: trece pe calea rapidă.
    const result = await prepareSelfie(blobOfSize(120_000), io, LIMITS);

    expect(result.ok).toBe(true);
    expect(io.encode).not.toHaveBeenCalled();
  });

  it('„too_large" când nici ultima treaptă nu intră sub limită', async () => {
    const io: CompressIo<DecodedImage> = {
      decode: vi.fn(async () => ({ width: 4032, height: 3024 })),
      // Encoder care nu slăbește niciodată: cazul-limită real.
      encode: vi.fn(async () => blobOfSize(20 * 1024 * 1024)),
    };

    await expect(prepareSelfie(blobOfSize(20 * 1024 * 1024), io, LIMITS)).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('„invalid_image" când browserul nu poate decoda fișierul (HEIC de pe iPhone)', async () => {
    const io: CompressIo<DecodedImage> = {
      decode: vi.fn(async () => {
        throw new Error('ilizibil');
      }),
      encode: vi.fn(),
    };

    await expect(prepareSelfie(blobOfSize(2000), io, LIMITS)).resolves.toEqual({
      ok: false,
      reason: 'invalid_image',
    });
  });

  it('„invalid_image" când fișierul ales nici măcar nu e imagine', async () => {
    const io: CompressIo<DecodedImage> = { decode: vi.fn(), encode: vi.fn() };

    await expect(
      prepareSelfie(blobOfSize(2000, 'application/pdf'), io, LIMITS),
    ).resolves.toEqual({ ok: false, reason: 'invalid_image' });
    expect(io.decode).not.toHaveBeenCalled();
  });
});
