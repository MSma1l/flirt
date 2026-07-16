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
import { Linking, Platform } from 'react-native';

import { CompressResult, LocalPhoto, PickedAsset, PickPhotoResult } from './types';
import {
  IMAGE_PROCESSING_FAILED_MESSAGE,
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

/**
 * Dimensiunea reală (bytes) a unei poze locale; 0 dacă nu poate fi citită.
 *
 * Pe WEB `expo-file-system` NU e implementat: `File` e un stub care doar dă un
 * `console.warn` și îi lipsește `validatePath`, deci `new File(uri)` ARUNCĂ mereu
 * → funcția întorcea 0 de fiecare dată. Consecința nu era cosmetică: bucla de
 * recompresie din `compressPhoto` se oprea din prima iterație (0 ≤ limită), așa
 * că o poză rămasă peste 8 MB pleca spre backend doar ca să fie respinsă cu 413.
 * În browser singura sursă reală de dimensiune e chiar blob-ul din spatele
 * URI-ului `blob:`/`data:`, deci îl citim de acolo.
 */
export async function fileSizeBytes(uri: string): Promise<number> {
  if (Platform.OS === 'web') {
    try {
      return (await (await fetch(uri)).blob()).size;
    } catch {
      return 0;
    }
  }
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
    // `manipulateAsync` poate ARUNCA, nu doar eșua: pe web încarcă poza într-un
    // `<img>`, iar dacă browserul nu știe formatul (HEIC de pe iPhone, fișier
    // corupt) respinge promisiunea — și o respinge cu un `HTMLCanvasElement`, nu
    // cu un `Error`. Îl transformăm într-un rezultat explicit, cu mesaj util:
    // altfel excepția urca până în `pickPhoto` și era raportată, greșit, drept
    // „nu am putut deschide galeria".
    let result: { uri: string; width: number; height: number };
    try {
      result = await manipulateAsync(asset.uri, actions, {
        compress: quality,
        format: SaveFormat.JPEG,
      });
    } catch {
      return { ok: false, message: IMAGE_PROCESSING_FAILED_MESSAGE };
    }

    const sizeBytes = await fileSizeBytes(result.uri);

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

  // Cele două etape au cauze de eșec DIFERITE, deci și mesaje diferite. Într-un
  // singur try/catch, o poză nedecodabilă (HEIC pe web) era raportată drept „nu am
  // putut deschide galeria" — neadevărat și fără nicio indicație ce să facă userul.
  let asset: PickedAsset | undefined;
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      // Calitate 1 la selecție: comprimăm NOI, controlat, mai jos.
      quality: 1,
      exif: false,
    });
    asset = result.canceled ? undefined : result.assets[0];
  } catch {
    return { status: 'rejected', message: PICKER_FAILED_MESSAGE };
  }

  if (!asset) return { status: 'cancelled' };

  // `compressPhoto` are mesajele lui (tip nepermis / prea mare / nedecodabilă) și
  // nu ar trebui să arunce; try/catch-ul rămâne doar ca plasă de siguranță.
  try {
    const compressed = await compressPhoto(asset);
    if (!compressed.ok) return { status: 'rejected', message: compressed.message };
    return { status: 'picked', photo: compressed.photo };
  } catch {
    return { status: 'rejected', message: IMAGE_PROCESSING_FAILED_MESSAGE };
  }
}
