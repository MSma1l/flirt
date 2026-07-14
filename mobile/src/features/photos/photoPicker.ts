/**
 * Selectarea unei poze din galerie + pregătirea ei pentru upload (TZ 2.4).
 *
 * Fluxul: permisiune → galerie → REDIMENSIONARE + COMPRESIE → validare finală.
 * Compresia nu e un moft: o poză de pe un telefon modern are 5–12 MB, iar
 * backend-ul respinge orice depășește `max_upload_bytes` (8 MB) cu 413. O trecem
 * prin `expo-image-manipulator` (max 1920px pe latura mare, JPEG) și, dacă tot nu
 * intră în limită, scădem calitatea până la `minCompressQuality`; abia dacă nici
 * atunci nu intră, o respingem cu un mesaj clar — fără upload sortit eșecului.
 */
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import { CompressResult, LocalPhoto, PickedAsset, PickPhotoResult } from './types';
import {
  OUTPUT_MIME_TYPE,
  PHOTO_LIMITS,
  PICKER_FAILED_MESSAGE,
  resizeTarget,
  tooLargeAfterCompression,
  validateSourceType,
} from './validation';

/** Starea permisiunii pentru galerie. */
export interface LibraryPermission {
  granted: boolean;
  /** False → sistemul nu mai afișează dialogul; rămân doar Setările. */
  canAskAgain: boolean;
}

/** Contor pentru nume de fișier unice (backend-ul oricum își generează cheia). */
let photoCounter = 0;

/**
 * Cere permisiunea la galerie: dacă e deja acordată nu deranjăm utilizatorul,
 * altfel afișăm dialogul de sistem.
 */
export async function ensureLibraryPermission(): Promise<LibraryPermission> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return { granted: true, canAskAgain: current.canAskAgain };

  const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return { granted: asked.granted, canAskAgain: asked.canAskAgain };
}

/** Deschide ecranul de Setări al aplicației (calea de recuperare după refuz). */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}

/** Dimensiunea reală (bytes) a unui fișier local; 0 dacă nu poate fi citită. */
export function fileSizeBytes(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

/** Rotunjire la 2 zecimale — evită erorile de virgulă mobilă la scăderea calității. */
function roundQuality(q: number): number {
  return Math.round(q * 100) / 100;
}

/**
 * Redimensionează + comprimă o poză până intră sub `maxUploadBytes`.
 * Întoarce `{ok:false, message}` dacă tipul e nepermis sau poza rămâne prea mare.
 */
export async function compressPhoto(asset: PickedAsset): Promise<CompressResult> {
  const typeError = validateSourceType(asset.mimeType);
  if (typeError) return { ok: false, message: typeError };

  const target = resizeTarget(asset.width, asset.height, PHOTO_LIMITS.maxDimension);
  const actions = target ? [{ resize: target }] : [];

  let quality = PHOTO_LIMITS.compressQuality;

  for (;;) {
    const result = await manipulateAsync(asset.uri, actions, {
      compress: quality,
      format: SaveFormat.JPEG,
    });
    const sizeBytes = fileSizeBytes(result.uri);

    // sizeBytes === 0 → platforma nu ne dă dimensiunea; nu blocăm utilizatorul
    // degeaba (backend-ul rămâne poarta finală, cu magic-bytes și limită de 8 MB).
    if (sizeBytes === 0 || sizeBytes <= PHOTO_LIMITS.maxUploadBytes) {
      photoCounter += 1;
      const photo: LocalPhoto = {
        uri: result.uri,
        width: result.width,
        height: result.height,
        mimeType: OUTPUT_MIME_TYPE,
        fileName: `photo-${Date.now()}-${photoCounter}.jpg`,
        sizeBytes,
      };
      return { ok: true, photo };
    }

    if (quality <= PHOTO_LIMITS.minCompressQuality) {
      return { ok: false, message: tooLargeAfterCompression(sizeBytes) };
    }
    quality = Math.max(
      PHOTO_LIMITS.minCompressQuality,
      roundQuality(quality - PHOTO_LIMITS.compressQualityStep),
    );
  }
}

/**
 * Deschide galeria și întoarce o poză gata de upload.
 *
 * Nu aruncă niciodată: orice eșec (permisiune refuzată, tip nepermis, poză prea
 * mare, eroare de sistem) devine un rezultat explicit, ca ecranul să poată afișa
 * un mesaj și o cale de recuperare în loc să crape.
 */
export async function pickPhoto(): Promise<PickPhotoResult> {
  let permission: LibraryPermission;
  try {
    permission = await ensureLibraryPermission();
  } catch {
    return { status: 'rejected', message: PICKER_FAILED_MESSAGE };
  }

  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      // Calitate 1 la selecție: comprimăm NOI, controlat, mai jos.
      quality: 1,
      exif: false,
    });

    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return { status: 'cancelled' };

    const compressed = await compressPhoto(asset);
    if (!compressed.ok) return { status: 'rejected', message: compressed.message };

    return { status: 'picked', photo: compressed.photo };
  } catch {
    return { status: 'rejected', message: PICKER_FAILED_MESSAGE };
  }
}
