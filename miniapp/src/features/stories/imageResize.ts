/**
 * Micșorarea pozei ÎNAINTE de a o trimite ca story, în browser, cu
 * `canvas.toBlob()`.
 *
 * DE CE e obligatoriu: o poză făcută cu un telefon modern (12 MP) are 5–12 MB,
 * iar `POST /stories/media` respinge cu 413 orice trece de `max_upload_bytes`
 * (8 MB, verificat în `backend/app/core/config.py`). Fără pasul ăsta, o bună
 * parte din încercările de publicare ar muri exact la ultimul clic.
 *
 * DE CE UN MODUL PROPRIU, deși `onboarding/imageCompress.ts` și
 * `profile/photoResize.ts` fac același lucru: ambele sunt ale altor agenți și
 * sunt legate de zona lor — `imageCompress` își ia pragurile din
 * `onboarding/photoLimits`, iar `photoResize` amestecă recompresia cu reguli de
 * NUMĂR de poze de profil (`validatePhotoCount`, min 2 / max 9), care n-au nimic
 * de-a face cu un story. `imageCompress.ts` e, de altfel, singurul dintre ele
 * curat reutilizabil ca modul (e pur și injectabil) — dacă cele două zone ajung
 * vreodată la același proprietar, fuziunea se face acolo. Până atunci păstrăm
 * CONVENȚIA lui, nu fișierul: aceleași trepte (1920 → 1440 → 1080 → 720, calitate
 * 0.8 → 0.5), aceeași ieșire JPEG, aceeași injecție a decodării/encodării.
 *
 * Ieșirea e mereu `image/jpeg`: e în allowlist-ul serverului
 * (`image/jpeg,image/png,image/webp`) și comprimă cel mai bine dintre ele.
 *
 * Modulul e PUR și INJECTABIL (`ResizeIo`): jsdom nu implementează nici
 * `createImageBitmap`, nici `canvas.toBlob`, deci fără injecție bucla de trepte —
 * singura logică ce merită testată — ar fi netestabilă.
 */
import i18n from '@/i18n';

/** Limitele serverului pentru media de story (`backend/app/core/config.py`). */
export const STORY_IMAGE_LIMITS = {
  maxUploadBytes: 8_388_608,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
} as const;

/** Treptele de micșorare. Întâi calitatea (mai ieftin vizual), apoi dimensiunea. */
export const STORY_COMPRESSION = {
  dimensions: [1920, 1440, 1080, 720] as readonly number[],
  qualities: [0.8, 0.7, 0.6, 0.5] as readonly number[],
  outputType: 'image/jpeg',
} as const;

/** Minimul pe care bucla îl știe despre o imagine decodată. */
export interface DecodedImage {
  width: number;
  height: number;
}

/** Decodarea și encodarea, injectate ca să poată fi înlocuite în teste. */
export interface ResizeIo<T extends DecodedImage = DecodedImage> {
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

/** De ce nu s-a putut pregăti poza. */
export type StoryImageFailure = 'type' | 'decode' | 'tooLarge';

/** Rezultatul pregătirii: fie un blob gata de trimis, fie un motiv + mesaj. */
export type PreparedStoryImage =
  | { ok: true; blob: Blob; fileName: string; width: number; height: number }
  | { ok: false; reason: StoryImageFailure; message: string };

/** Formatează bytes în MB, cu o zecimală (fără „.0" inutil). */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * Mesajele de eroare vin din catalogul propriu al Mini App-ului
 * (`screens:stories.image.*`): cataloagele mobile NU au chei pentru „tip
 * nepermis", „poză ilizibilă" sau „prea mare după micșorare", iar sarcina
 * interzice modificarea lor.
 *
 * Modulul e cod pur, chemat în afara randării, deci nu poate folosi hook-ul
 * `useTranslation`. Citește din instanța globală `i18n` — aceeași soluție ca în
 * `features/events/eventFormat.ts`. Sunt FUNCȚII, nu constante: o constantă s-ar
 * evalua o singură dată, la import, și ar îngheța limba de la pornire.
 */
export function notAnImageMessage(): string {
  return i18n.t('screens:stories.image.notAnImage');
}

/**
 * Cazul real din spatele acestui mesaj: HEIC/HEIF, formatul implicit al
 * iPhone-ului, pe care majoritatea browserelor nu îl deschid. Utilizatorul
 * trebuie să afle CE are de făcut, nu doar că „ceva n-a mers".
 */
export function decodeFailedMessage(): string {
  return i18n.t('screens:stories.image.decodeFailed');
}

/** Mesaj când nici la ultima treaptă poza nu intră sub limita serverului. */
export function tooLargeMessage(sizeBytes: number, maxBytes: number): string {
  return i18n.t('screens:stories.image.tooLarge', {
    size: formatMb(sizeBytes),
    limit: formatMb(maxBytes),
  });
}

/**
 * Dimensiunea la care desenăm, păstrând proporțiile.
 * NU mărim niciodată o poză mică: ar fi doar octeți în plus, fără calitate.
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

/**
 * Fișierul ales arată a imagine?
 *
 * Tipul GOL e acceptat: unele sisteme nu îl raportează, iar poarta finală rămâne
 * serverul, care forțează tipul din magic-bytes. Orice altceva (PDF, video) e
 * respins AICI, înainte de upload — n-are rost să urcăm 40 MB ca să primim 422.
 */
function looksLikeImage(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === '' || t.startsWith('image/');
}

/** Contor pentru nume unice de fișier (backendul își generează oricum cheia). */
let counter = 0;

/**
 * Pregătește poza pentru `POST /stories/media`: o decodează, o micșorează și o
 * recomprimă în trepte până intră sub `maxUploadBytes`.
 *
 * Nu aruncă niciodată: orice eșec devine un rezultat explicit cu mesaj, ca
 * ecranul să poată spune utilizatorului ce are de făcut.
 */
export async function prepareStoryImage<T extends DecodedImage>(
  file: File | Blob,
  io: ResizeIo<T>,
  limits: { maxUploadBytes: number; allowedTypes: readonly string[] } = STORY_IMAGE_LIMITS,
  compression: {
    dimensions: readonly number[];
    qualities: readonly number[];
    outputType: string;
  } = STORY_COMPRESSION,
): Promise<PreparedStoryImage> {
  if (!looksLikeImage(file.type)) {
    return { ok: false, reason: 'type', message: notAnImageMessage() };
  }

  let image: T;
  try {
    image = await io.decode(file);
  } catch {
    return { ok: false, reason: 'decode', message: decodeFailedMessage() };
  }

  counter += 1;
  const baseName = `story-${Date.now()}-${counter}`;

  try {
    const biggestAllowed = compression.dimensions[0] ?? 0;
    // Poza e deja mică ȘI într-un format acceptat → pleacă NEATINSĂ. O
    // re-encodare ar pierde calitate degeaba (și ar umfla un PNG cu text).
    if (
      file.size > 0 &&
      file.size <= limits.maxUploadBytes &&
      limits.allowedTypes.includes(file.type) &&
      Math.max(image.width, image.height) <= biggestAllowed
    ) {
      const ext =
        file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      return {
        ok: true,
        blob: file,
        fileName: `${baseName}.${ext}`,
        width: image.width,
        height: image.height,
      };
    }

    let smallest = Number.POSITIVE_INFINITY;

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
        // Encoder indisponibil (browser fără `toBlob`, canvas fără context):
        // tratat ca poză ilizibilă, cu același mesaj acționabil.
        if (!blob) return { ok: false, reason: 'decode', message: decodeFailedMessage() };

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

    const sizeBytes = Number.isFinite(smallest) ? smallest : file.size;
    return {
      ok: false,
      reason: 'tooLarge',
      message: tooLargeMessage(sizeBytes, limits.maxUploadBytes),
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
      // Mesaj tehnic, în engleză, DELIBERAT: eroarea asta nu ajunge niciodată pe
      // ecran — apelantul o prinde și o înlocuiește cu `decodeFailedMessage()`,
      // care e tradus. Un text românesc aici ar fi doar un șir de tradus degeaba.
      el.onerror = () => reject(new Error('story image: decode failed'));
      el.src = url;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) {
      URL.revokeObjectURL(url);
      throw new Error('story image: missing dimensions');
    }
    return {
      width,
      height,
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
export const browserIo: ResizeIo<BrowserImage> = {
  decode: decodeInBrowser,
  encode: encodeInBrowser,
  release: (image) => image.dispose(),
};

/**
 * Ce cheamă ecranul: pregătirea pozei cu API-urile reale ale browserului.
 *
 * Există ca funcție separată tocmai ca `prepareStoryImage` să rămână pur și
 * injectabil: `io` nu poate avea o valoare implicită (`ResizeIo` e invariant în
 * `T`, deci `ResizeIo<BrowserImage>` nu se potrivește cu un `ResizeIo<T>`
 * generic), iar ecranul n-are de ce să știe de `browserIo`.
 */
export function prepareStoryImageInBrowser(file: File | Blob): Promise<PreparedStoryImage> {
  return prepareStoryImage(file, browserIo);
}
