/**
 * Pregătirea pozei ÎNAINTE de upload.
 *
 * Regula apărată aici: nimic nu pleacă spre backend peste `max_upload_bytes`.
 * Decodarea și encodarea sunt injectate — jsdom nu are nici `createImageBitmap`,
 * nici `canvas.toBlob`, iar ce contează e bucla de trepte, nu encoderul.
 */
import { describe, expect, it, vi } from 'vitest';

import { compressImage, scaleToFit, sniffImageType, type CompressIo } from '../imageCompress';

const LIMITS = { maxUploadBytes: 8_388_608, allowedTypes: ['image/jpeg', 'image/png'] };
const COMPRESSION = {
  dimensions: [1920, 1440, 1080, 720],
  qualities: [0.8, 0.7, 0.6, 0.5],
  outputType: 'image/jpeg',
};

/** Primii octeți REALI ai fiecărui format — exact ce citește backendul. */
const MAGIC: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00],
  // Un HEIC: `ftypheic` la offset 4. Niciun browser obișnuit nu-l decodează.
  'image/heic': [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
};

/**
 * Un fișier fals: mărimea și ETICHETA (`type`) sunt separate de CONȚINUT
 * (`content`) — exact separarea care produce defectul din producție, când
 * sistemul de operare pune o etichetă greșită pe o poză perfect validă.
 */
function fakeFile(size: number, type = 'image/jpeg', content = type): File {
  const head = new Uint8Array(MAGIC[content] ?? [0x00, 0x01, 0x02, 0x03]);
  return {
    size,
    type,
    slice: () => ({ arrayBuffer: async () => head.buffer }) as unknown as Blob,
  } as unknown as File;
}

/**
 * Encoder fals: mărimea rezultatului crește cu numărul de pixeli și cu
 * calitatea, exact ca un JPEG real. `factor` reglează cât de „grea" e poza.
 */
function fakeIo(width: number, height: number, factor: number) {
  const encode = vi.fn(
    async (_img: { width: number; height: number }, w: number, h: number, q: number) =>
      ({ size: Math.round(w * h * q * factor) }) as Blob,
  );
  const io: CompressIo<{ width: number; height: number }> = {
    decode: vi.fn(async () => ({ width, height })),
    encode,
    release: vi.fn(),
  };
  return { io, encode };
}

describe('scaleToFit', () => {
  it('păstrează proporțiile când micșorează', () => {
    expect(scaleToFit(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 });
    expect(scaleToFit(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 });
  });

  it('NU mărește niciodată o poză mai mică decât ținta', () => {
    expect(scaleToFit(800, 600, 1920)).toEqual({ width: 800, height: 600 });
  });
});

describe('recompresia în trepte', () => {
  it('coboară întâi calitatea, apoi dimensiunea, până intră sub limită', async () => {
    // Cu `factor = 8`, nicio calitate nu ajunge la 1920px; abia la 1440px trece.
    const { io, encode } = fakeIo(4000, 3000, 8);

    const result = await compressImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.width).toBe(1440);
    expect(result.height).toBe(1080);
    expect(result.blob.size).toBeLessThanOrEqual(LIMITS.maxUploadBytes);
    // 4 încercări la 1920 + 3 la 1440 (a treia reușește).
    expect(encode).toHaveBeenCalledTimes(7);
    expect(result.fileName.endsWith('.jpg')).toBe(true);
  });

  it('se oprește la PRIMA variantă care intră sub limită', async () => {
    const { io, encode } = fakeIo(4000, 3000, 1);

    const result = await compressImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('o poză deja mică și în format acceptat pleacă NEATINSĂ', async () => {
    const { io, encode } = fakeIo(800, 600, 1);
    const file = fakeFile(120_000, 'image/jpeg');

    const result = await compressImage(file, io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob).toBe(file);
    expect(encode).not.toHaveBeenCalled();
  });

  it('un format neacceptat de backend e re-encodat, chiar dacă e mic', async () => {
    const { io, encode } = fakeIo(800, 600, 1);

    const result = await compressImage(fakeFile(100_000, 'image/heic'), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    expect(encode).toHaveBeenCalled();
  });

  it('nu are încredere în eticheta sistemului: decide după CONȚINUT', async () => {
    // Defectul real: un JPEG pe care sistemul îl declară `image/png`. Pe calea
    // veche pleca NEATINS, cu tipul greșit, iar backendul (care verifică
    // magic-bytes) îl respingea cu 422 — o poză perfect validă, refuzată.
    const { io, encode } = fakeIo(800, 600, 1);
    const file = fakeFile(120_000, 'image/png', 'image/jpeg');

    const result = await compressImage(file, io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nu re-encodăm degeaba: octeții sunt buni, doar eticheta era greșită.
    expect(encode).not.toHaveBeenCalled();
    expect(result.blob.type).toBe('image/jpeg');
    expect(result.fileName.endsWith('.jpg')).toBe(true);
  });

  it('o etichetă „bună" pusă pe un conținut neacceptat duce la normalizare', async () => {
    // Invers: un GIF declarat `image/jpeg`. Backendul l-ar refuza; noi îl
    // re-encodăm în JPEG, deci ajunge exact ce a declarat partea multipart.
    const { io, encode } = fakeIo(800, 600, 1);

    const result = await compressImage(
      fakeFile(100_000, 'image/jpeg', 'image/gif'),
      io,
      LIMITS,
      COMPRESSION,
    );

    expect(result.ok).toBe(true);
    expect(encode).toHaveBeenCalled();
  });

  it('când conținutul nu poate fi citit, normalizăm în loc să ghicim', async () => {
    const { io, encode } = fakeIo(800, 600, 1);
    const unreadable = { size: 100_000, type: 'image/jpeg' } as File; // fără `slice`

    const result = await compressImage(unreadable, io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(true);
    expect(encode).toHaveBeenCalled();
  });

  it('raportează „prea mare" cu cea mai mică variantă obținută', async () => {
    const { io } = fakeIo(4000, 3000, 1000);

    const result = await compressImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('tooLarge');
    if (result.reason !== 'tooLarge') return;
    // Ultima treaptă: 720px, calitate 0.5.
    expect(result.sizeBytes).toBe(Math.round(720 * 540 * 0.5 * 1000));
  });
});

describe('fișiere pe care nu le putem folosi', () => {
  it('refuză ce nu e imagine, fără să încerce decodarea', async () => {
    const { io } = fakeIo(10, 10, 1);

    const result = await compressImage(fakeFile(1000, 'application/pdf'), io, LIMITS, COMPRESSION);

    expect(result).toEqual({ ok: false, reason: 'type' });
    expect(io.decode).not.toHaveBeenCalled();
  });

  it('o poză pe care browserul nu o poate citi (HEIC) dă „decode", nu o excepție', async () => {
    const io: CompressIo<{ width: number; height: number }> = {
      decode: vi.fn(async () => {
        throw new Error('format necunoscut');
      }),
      encode: vi.fn(),
    };

    const result = await compressImage(fakeFile(3_000_000), io, LIMITS, COMPRESSION);

    expect(result).toEqual({ ok: false, reason: 'decode' });
  });

  it('eliberează imaginea decodată chiar și când nu reușește', async () => {
    const { io } = fakeIo(4000, 3000, 1000);

    await compressImage(fakeFile(12_000_000), io, LIMITS, COMPRESSION);

    expect(io.release).toHaveBeenCalledTimes(1);
  });
});

describe('sniffImageType', () => {
  it('recunoaște formatele pe care backendul le acceptă', () => {
    expect(sniffImageType(new Uint8Array(MAGIC['image/jpeg'] as number[]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array(MAGIC['image/png'] as number[]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array(MAGIC['image/webp'] as number[]))).toBe('image/webp');
  });

  it('recunoaște și un format pe care backendul îl refuză', () => {
    expect(sniffImageType(new Uint8Array(MAGIC['image/gif'] as number[]))).toBe('image/gif');
  });

  it('întoarce `null` pentru octeți necunoscuți sau prea puțini', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array(MAGIC['image/heic'] as number[]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it('nu confundă un RIFF care nu e WEBP (un .wav) cu o imagine', () => {
    const wav = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45];
    expect(sniffImageType(new Uint8Array(wav))).toBeNull();
  });
});
