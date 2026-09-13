/**
 * Verificarea facială: trimite selfie-ul la backend și întoarce verdictul.
 *
 * CONTRACTUL, citit din sursă, nu presupus — `backend/app/api/v1/profiles.py`,
 * `verify_face`:
 *   `POST /api/v1/profiles/verify-face`, `multipart/form-data`, câmpul `file`.
 *   Octeții trec prin `_validate_image_upload` (dimensiune ≤ `max_upload_bytes`,
 *   tip declarat în allowlist, magic-bytes verificate), apoi prin
 *   `profile_service.verify_face` → providerul din `services/face_verify.py`.
 *   Răspunsul e `{verified: bool, similarity: float}` (`FaceVerifyOut`), iar
 *   `Profile.verified` se salvează după el.
 *
 * Ruta acceptă și un body JSON (rămășiță din modul stub) — NU îl folosim. Pe
 * serverul nostru providerul e `stub` și ar întoarce `(True, 99.0)` orice i-am
 * da; dacă am trimite un body gol, codul ăsta ar „merge" în dezvoltare și ar
 * cădea în ziua în care se activează Rekognition. Trimitem mereu octeți reali.
 *
 * REUTILIZAT prin import, nu copiat: `faceVerifyReason` din
 * `mobile/src/features/verification/messages.ts` — maparea status HTTP → motiv
 * și cheile de traducere sunt deja scrise și testate acolo, iar modulul e pur
 * (axios + i18n). Singurul `@/` pe care îl importă e `@/i18n`, care în Mini App
 * duce la i18n-ul de aici (vezi `tsconfig.json`, `paths`).
 */
import { api } from '@/api/client';

import { faceVerifyReason, type FaceVerifyReason } from '@mobile/features/verification/messages';

export type { FaceVerifyReason };
export { faceVerifyReason };

/** Verdictul serverului. `similarity` e 0–100 (0 când nu s-a potrivit nimic). */
export interface FaceVerification {
  verified: boolean;
  similarity: number;
}

/** Forma brută a lui `FaceVerifyOut`. */
interface FaceVerifyResponse {
  verified?: boolean;
  similarity?: number;
}

/**
 * Eșec de verificare, cu motivul deja clasificat.
 *
 * Mesajul `Error` e un cod tehnic, nu text de interfață: ecranul afișează
 * traducerea lui `reason` (`verification:reasons.*`), ca textul să urmeze limba
 * activă chiar dacă eroarea a fost creată în altă limbă.
 */
export class FaceVerifyError extends Error {
  readonly reason: FaceVerifyReason;

  constructor(reason: FaceVerifyReason) {
    super(`face-verify:${reason}`);
    this.name = 'FaceVerifyError';
    this.reason = reason;
  }
}

/**
 * Urcă selfie-ul și întoarce verdictul.
 *
 * `verified === false` NU e o eroare: e un răspuns valid al serverului
 * („nu e el"), iar ecranul îl arată ca atare. Doar cererile care nu ajung la un
 * verdict aruncă `FaceVerifyError`.
 *
 * Nu punem `Content-Type` pe cerere: cu `FormData`, browserul îl scrie singur,
 * CU granița multipart. Unul scris de noi ar fi fără graniță, iar FastAPI n-ar
 * găsi câmpul `file` (mobilul îl setează fiindcă `FormData` din React Native nu
 * e cel din browser).
 */
export async function verifyFace(blob: Blob, fileName: string): Promise<FaceVerification> {
  const form = new FormData();
  form.append('file', blob, fileName);

  try {
    const { data } = await api.post<FaceVerifyResponse>('/profiles/verify-face', form);
    return {
      verified: data.verified === true,
      similarity: Number(data.similarity) || 0,
    };
  } catch (error) {
    throw new FaceVerifyError(faceVerifyReason(error));
  }
}
