/**
 * Decodorul de QR pentru scannerul de la intrare.
 *
 * Ordinea: `BarcodeDetector` nativ (Android Chrome — rapid, pe GPU), altfel
 * `jsqr` pe cadre desenate într-un canvas (iPhone Safari nu are BarcodeDetector).
 * `jsqr` e importat LENEȘ: ajunge în bundle doar pe dispozitivele care îl cer.
 */

export interface QrDecoder {
  /** Codul găsit în cadrul curent al video-ului sau `null`. */
  decode: (video: HTMLVideoElement) => Promise<string | null>;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

// Latura maximă a cadrului dat lui jsqr: un QR ținut în fața camerei se citește
// sigur și la 640px, iar cadrele mai mici înseamnă scanare fluidă pe telefoane slabe.
const MAX_FRAME_SIDE = 640;

async function nativeDecoder(): Promise<QrDecoder | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = Ctor.getSupportedFormats ? await Ctor.getSupportedFormats() : ['qr_code'];
    if (!formats.includes('qr_code')) return null;
    const detector = new Ctor({ formats: ['qr_code'] });
    return {
      decode: async (video) => {
        const found = await detector.detect(video);
        return found[0]?.rawValue ?? null;
      },
    };
  } catch {
    return null;
  }
}

async function jsqrDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    decode: async (video) => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!ctx || !width || !height) return null;
      const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(width, height));
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      const result = jsQR(image.data, w, h, { inversionAttempts: 'attemptBoth' });
      return result?.data || null;
    },
  };
}

export async function createQrDecoder(): Promise<QrDecoder> {
  return (await nativeDecoder()) ?? (await jsqrDecoder());
}
