/**
 * Verificare facială (TZ secț. 2.2): trimite selfie-ul REAL la backend pentru a
 * confirma că profilul aparține unei persoane reale.
 *
 * Forma cererii e dictată de backend (`app/api/v1/profiles.py` → `verify_face`):
 * `multipart/form-data` cu câmpul `file`. Serverul citește bytes-ii, îi trece prin
 * aceeași validare ca la pozele de profil (dimensiune, tip declarat, magic-bytes)
 * și îi dă lui AWS Rekognition spre comparare cu pozele proprii ale profilului.
 * Ruta acceptă și un body JSON (rămășiță din modul stub) — noi NU îl folosim:
 * fără bytes reali nu există verificare reală, deci nici badge meritat.
 *
 * Răspuns: `{verified: bool, similarity: float}` (similaritatea e 0–100).
 */
import { LocalPhoto } from '@/features/photos';
import { api } from '@/services/api';

import { faceVerifyMessage, faceVerifyReason, FaceVerifyReason } from './messages';

/** Rezultatul verificării faciale. */
export interface FaceVerification {
  verified: boolean;
  /** Scor de similaritate 0–100 (0 când nu s-a găsit nicio potrivire). */
  similarity: number;
}

/* ------------------------- Formă brută (backend) ------------------------- */

interface FaceVerificationResponse {
  verified: boolean;
  similarity: number;
}

/* ------------------------------- Erori ---------------------------------- */

/** Eroare de verificare cu mesaj deja tradus + motivul, pentru ecran. */
export class FaceVerifyError extends Error {
  readonly reason: FaceVerifyReason;

  constructor(reason: FaceVerifyReason) {
    super(faceVerifyMessage(reason));
    this.name = 'FaceVerifyError';
    this.reason = reason;
  }
}

/* ------------------------------- API ----------------------------------- */

/** Partea de fișier dintr-un `FormData` React Native (nu e un `Blob` web). */
interface RNFilePart {
  uri: string;
  name: string;
  type: string;
}

/**
 * Încarcă selfie-ul și întoarce verdictul.
 *
 * La eșec aruncă `FaceVerifyError` cu mesajul gata de afișat. Un `verified=false`
 * NU e o eroare — e un verdict valid al serverului, pe care ecranul îl arată ca
 * atare (badge neacordat), fără să confunde „nu se potrivește" cu „a picat rețeaua".
 */
export async function verifyFace(selfie: LocalPhoto): Promise<FaceVerification> {
  const form = new FormData();
  const part: RNFilePart = {
    uri: selfie.uri,
    name: selfie.fileName,
    // Backend-ul cere un `content_type` din allowlist; magic-bytes sunt oricum
    // verificate server-side, deci un tip declarat fals n-ar trece de validare.
    type: selfie.mimeType,
  };
  // RN acceptă un obiect {uri,name,type} ca fișier; tipurile DOM cer `Blob`.
  form.append('file', part as unknown as Blob);

  try {
    const { data } = await api.post<FaceVerificationResponse>(
      '/profiles/verify-face',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return {
      verified: !!data.verified,
      similarity: Number(data.similarity) || 0,
    };
  } catch (error) {
    throw new FaceVerifyError(faceVerifyReason(error));
  }
}
