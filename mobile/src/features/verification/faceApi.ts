/**
 * Verificare facială (TZ secț. 2.2): trimite un selfie la backend pentru a
 * confirma că profilul aparține unei persoane reale. Mapează răspunsul brut.
 */
import { api } from '@/services/api';

/** Rezultatul verificării faciale, în camelCase. */
export interface FaceVerification {
  verified: boolean;
  similarity: number;
}

/* ------------------------- Formă brută (backend) ------------------------- */

interface FaceVerificationResponse {
  verified: boolean;
  similarity: number;
}

/* ------------------------------- API ----------------------------------- */

/**
 * Trimite selfie-ul spre verificare și întoarce rezultatul.
 *
 * PROD: trimite selfie-ul (expo-image-picker/expo-camera) ca multipart
 * (FormData cu fișierul imaginii). În stub trimitem un body minimal.
 */
export async function verifyFace(): Promise<FaceVerification> {
  const { data } = await api.post<FaceVerificationResponse>('/profiles/verify-face', {
    // PROD: aici va veni imaginea (multipart). Stub: marker de sursă.
    source: 'selfie',
  });
  return { verified: !!data.verified, similarity: data.similarity };
}
