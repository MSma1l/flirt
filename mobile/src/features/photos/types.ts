/** Tipuri pentru pozele de profil (TZ 2.4): selecție din galerie + upload. */

/** O poză aleasă din galerie, DEJA redimensionată și comprimată local. */
export interface LocalPhoto {
  /** URI-ul fișierului local (rezultatul compresiei, nu originalul din galerie). */
  uri: string;
  /** Tipul MIME final — mereu unul din `config.photos.allowedTypes`. */
  mimeType: string;
  /** Numele trimis în multipart (backend-ul îl ignoră: cheia o generează el). */
  fileName: string;
  /** Dimensiunea în bytes după compresie (0 = necunoscută pe platforma curentă). */
  sizeBytes: number;
  width: number;
  height: number;
}

/** Câmpurile de care avem nevoie dintr-un asset returnat de `expo-image-picker`. */
export interface PickedAsset {
  uri: string;
  width: number;
  height: number;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number;
}

/** Rezultatul unei încercări de a alege o poză din galerie. */
export type PickPhotoResult =
  /** Poză aleasă, validată și comprimată — gata de upload. */
  | { status: 'picked'; photo: LocalPhoto }
  /** Utilizatorul a închis galeria fără să aleagă. */
  | { status: 'cancelled' }
  /**
   * Permisiunea la galerie a fost refuzată. `canAskAgain=false` → sistemul nu mai
   * afișează dialogul, singura cale de recuperare e ecranul de Setări.
   */
  | { status: 'denied'; canAskAgain: boolean }
  /** Poza a fost respinsă local (tip nepermis / prea mare) sau galeria a eșuat. */
  | { status: 'rejected'; message: string };

/** Rezultatul compresiei unei poze înainte de upload. */
export type CompressResult =
  | { ok: true; photo: LocalPhoto }
  | { ok: false; message: string };

/** O celulă din grila de poze (URL de pe server sau URI local în curs de upload). */
export interface PhotoTile {
  /** Cheie stabilă pentru React (URL/URI). */
  key: string;
  /** Sursa afișată în `Image`. */
  uri: string;
  /** True cât timp poza se încarcă pe server. */
  uploading?: boolean;
  /** Progresul uploadului (0–1), afișat ca procent. */
  progress?: number;
}
