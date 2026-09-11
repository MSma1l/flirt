/**
 * Redimensionare + recompresie a unei poze ÎNAINTE de upload, în browser.
 *
 * DE CE: o poză de pe un telefon are 5–12 MB și 4000×3000, iar backendul
 * respinge cu 413 orice trece de `max_upload_bytes` (8 MB). Fără pasul ăsta,
 * jumătate din încercările de înregistrare ar eșua exact la ultimul pas.
 *
 * PORT al lui `mobile/src/features/photos/photoPicker.ts` (`compressPhoto`):
 * aceeași idee — redimensionează pe latura mare, apoi coboară calitatea în
 * trepte până intră sub limită. Două diferențe, ambele deliberate:
 *   1. `expo-image-manipulator` nu există pe web; encoderul e `canvas.toBlob()`;
 *   2. mobilul renunță când a ajuns la calitatea minimă. Aici mai coborâm ȘI
 *      dimensiunea (1920 → 1440 → 1080 → 720). O poză de 12 MB dintr-un telefon
 *      modern ajunge la calitate 0.5 pe 1920px încă peste limită pe unele
 *      aparate; renunțarea acolo ar însemna „alege altă poză" pentru o poză
 *      perfect bună.
 *
 * Modulul e PUR și INJECTABIL: decodarea și encodarea intră prin `CompressIo`.
 * jsdom nu implementează nici `createImageBitmap`, nici `canvas.toBlob`, deci
 * fără injecție bucla de trepte — singura logică care chiar merită testată — ar
 * fi netestabilă.
 */
import { COMPRESSION, PHOTO_LIMITS } from './photoLimits';

/** Minimul pe care bucla îl știe despre o imagine decodată. */
export interface DecodedImage {
  width: number;
  height: number;
}

/** Decodarea și encodarea, injectate ca să poată fi înlocuite în teste. */
export interface CompressIo<T extends DecodedImage = DecodedImage> {
  /** Transformă fișierul ales în ceva desenabil. Aruncă dacă formatul e ilizibil. */
  decode: (file: Blob) => Promise<T>;
  /** Desenează la dimensiunea cerută și encodează. `null` = encoder indisponibil. */
  encode: (
    image: T,
    width: number,
    height: number,
    quality: number,
    type: string,
  ) => Promise<Blob | null>;
  /** Eliberează resursele imaginii decodate (ImageBitmap, objectURL). */
  release?: (image: T) => void;
}

/** Ce se poate întâmpla cu o poză înainte de upload. */
export type CompressResult =
  | { ok: true; blob: Blob; fileName: string; width: number; height: number }
  /** Fișierul nu e o imagine (utilizatorul a ales un PDF, un video). */
  | { ok: false; reason: 'type' }
  /** E imagine, dar browserul nu o poate decoda (HEIC de pe iPhone, fișier rupt). */
  | { ok: false; reason: 'decode' }
  /** Nici la ultima treaptă nu intră sub limită. `sizeBytes` = cea mai mică obținută. */
  | { ok: false; reason: 'tooLarge'; sizeBytes: number };

/** Contor pentru nume unice de fișier (backendul își generează oricum cheia). */
let counter = 0;

/**
 * Dimensiunea la care desenăm, păstrând proporțiile.
 * NU mărim niciodată o poză mică: ar fi doar octeți în plus, fără calitate.
 * Exportată pentru teste — e regula pe care se sprijină toată bucla.
 */
export function scaleToFit(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const ratio = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Fișierul ales arată a imagine? Tipul gol e acceptat — unele sisteme nu-l dau. */
function looksLikeImage(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === '' || t.startsWith('image/');
}

/**
 * Pregătește o poză pentru upload: o decodează, o micșorează și o recomprimă
 * până intră sub `maxUploadBytes`.
 *
 * Nu aruncă niciodată: orice eșec devine un rezultat explicit, ca ecranul să
 * poată spune utilizatorului ce are de făcut.
 */
export async function compressImage<T extends DecodedImage>(
  file: File | Blob,
  io: CompressIo<T>,
  limits: { maxUploadBytes: number; allowedTypes: readonly string[] } = PHOTO_LIMITS,
  compression: {
    dimensions: readonly number[];
    qualities: readonly number[];
    outputType: string;
  } = COMPRESSION,
): Promise<CompressResult> {
  if (!looksLikeImage(file.type)) return { ok: false, reason: 'type' };

  let image: T;
  try {
    image = await io.decode(file);
  } catch {
    return { ok: false, reason: 'decode' };
  }

  counter += 1;
  const baseName = `photo-${Date.now()}-${counter}`;

  try {
    const biggestAllowed = compression.dimensions[0] ?? 0;
    // Poza e deja mică ȘI într-un format acceptat → o trimitem NEATINSĂ.
    // O re-encodare ar pierde calitate degeaba (și ar mări un PNG cu text).
    if (
      file.size > 0 &&
      file.size <= limits.maxUploadBytes &&
      limits.allowedTypes.includes(file.type) &&
      Math.max(image.width, image.height) <= biggestAllowed
    ) {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      return {
        ok: true,
        blob: file,
        fileName: `${baseName}.${ext}`,
        width: image.width,
        height: image.height,
      };
    }

    let smallest = Number.POSITIVE_INFINITY;

    // Trepte: întâi calitatea (mai ieftin vizual), apoi dimensiunea.
    for (const maxDimension of compression.dimensions) {
      const target = scaleToFit(image.width, image.height, maxDimension);
      for (const quality of compression.qualities) {
        const blob = await io.encode(
          image,
          target.width,
          target.height,
          quality,
          compression.outputType,
        );
        // Encoder indisponibil (browser fără `toBlob`): nu blocăm utilizatorul,
        // backendul rămâne poarta finală cu limita lui de 8 MB.
        if (!blob) return { ok: false, reason: 'decode' };

        if (blob.size <= limits.maxUploadBytes) {
          return {
            ok: true,
            blob,
            fileName: `${baseName}.jpg`,
            width: target.width,
            height: target.height,
          };
        }
        smallest = Math.min(smallest, blob.size);
      }
    }

    return {
      ok: false,
      reason: 'tooLarge',
      sizeBytes: Number.isFinite(smallest) ? smallest : file.size,
    };
  } finally {
    io.release?.(image);
  }
}

// ——— Implementarea reală, peste API-urile browserului ———

interface BrowserImage extends DecodedImage {
  source: CanvasImageSource;
  dispose: () => void;
}

/** Decodare cu `createImageBitmap`, cu revenire pe `<img>` + objectURL. */
async function decodeInBrowser(file: Blob): Promise<BrowserImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      dispose: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('imagine ilizibilă'));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      source: img,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Encodare pe `<canvas>`. `toBlob` e asincron și poate da `null`. */
async function encodeInBrowser(
  image: BrowserImage,
  width: number,
  height: number,
  quality: number,
  type: string,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image.source, 0, 0, width, height);
  if (typeof canvas.toBlob !== 'function') return null;
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/** Perechea decodare/encodare folosită în producție. */
export const browserIo: CompressIo<BrowserImage> = {
  decode: decodeInBrowser,
  encode: encodeInBrowser,
  release: (image) => image.dispose(),
};
