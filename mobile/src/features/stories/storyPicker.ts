/**
 * Alegerea unei media de story din galerie (imagine SAU video) + pregătirea ei
 * pentru upload (TZ secț. 11), stil Instagram.
 *
 * Imaginile trec prin ACEEAȘI compresie ca pozele de profil (`compressPhoto` din
 * `features/photos`, singurul loc cu limitele de upload) — un JPEG de pe un telefon
 * modern ar lua altfel 413. Videoclipurile se trimit ca atare (nu le recomprimăm
 * pe client), dar filtrăm durata (max 30s) și dimensiunea ÎNAINTE de upload.
 */
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import { compressPhoto, ensureLibraryPermission } from '@/features/photos';

import { StoryMediaFile } from './storiesApi';
import {
  DEFAULT_VIDEO_MIME,
  STORY_MESSAGES,
  STORY_VIDEO_MAX_BYTES,
  STORY_VIDEO_MAX_SECONDS,
} from './storyLimits';

/** Rezultatul alegerii unei media — nu aruncă niciodată. */
export type PickStoryResult =
  /** Media aleasă, validată/comprimată — gata de upload. */
  | { status: 'picked'; file: StoryMediaFile }
  /** Utilizatorul a închis galeria fără să aleagă. */
  | { status: 'cancelled' }
  /** Permisiune refuzată; `canAskAgain=false` → doar ecranul de Setări mai ajută. */
  | { status: 'denied'; canAskAgain: boolean }
  /** Media respinsă local (prea mare/prea lungă) sau galeria a eșuat. */
  | { status: 'rejected'; message: string };

/** Deschide ecranul de Setări al aplicației (calea de recuperare după refuz). */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}

/** Contor pentru nume de fișier unice (backend-ul oricum își generează cheia). */
let clipCounter = 0;

/** Extrage extensia din URI pentru a alege un MIME plauzibil (backend-ul reconfirmă). */
function videoMimeFromUri(uri: string, declared?: string | null): string {
  if (declared && declared.startsWith('video/')) return declared;
  return /\.mov($|\?)/i.test(uri) ? 'video/quicktime' : DEFAULT_VIDEO_MIME;
}

/** Pregătește un asset video pentru upload; respinge dacă e prea mare. */
function prepareVideo(asset: ImagePicker.ImagePickerAsset): PickStoryResult {
  // Dimensiune peste limită → oprim înainte de un upload inutil (când o știm).
  if (typeof asset.fileSize === 'number' && asset.fileSize > STORY_VIDEO_MAX_BYTES) {
    return { status: 'rejected', message: STORY_MESSAGES.videoTooLarge };
  }
  clipCounter += 1;
  const mimeType = videoMimeFromUri(asset.uri, asset.mimeType);
  const ext = mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  return {
    status: 'picked',
    file: {
      uri: asset.uri,
      mimeType,
      fileName: `story-${Date.now()}-${clipCounter}.${ext}`,
      mediaType: 'video',
    },
  };
}

/** Pregătește un asset imagine: compresie (reia logica pozelor de profil). */
async function prepareImage(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PickStoryResult> {
  const compressed = await compressPhoto({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType ?? undefined,
  });
  if (!compressed.ok) return { status: 'rejected', message: compressed.message };
  return {
    status: 'picked',
    file: {
      uri: compressed.photo.uri,
      mimeType: compressed.photo.mimeType,
      fileName: compressed.photo.fileName,
      mediaType: 'image',
    },
  };
}

/**
 * Deschide galeria (imagini + video) și întoarce media gata de upload.
 *
 * Nu aruncă: orice eșec (permisiune, tip nepermis, clip prea mare, eroare de
 * sistem) devine un rezultat explicit, ca ecranul să afișeze un mesaj și o cale
 * de recuperare în loc să crape.
 */
export async function pickStoryMedia(): Promise<PickStoryResult> {
  let permission;
  try {
    permission = await ensureLibraryPermission();
  } catch {
    return { status: 'rejected', message: STORY_MESSAGES.pickerFailed };
  }
  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: false,
      quality: 1, // comprimăm NOI imaginile, controlat, mai jos
      videoMaxDuration: STORY_VIDEO_MAX_SECONDS,
      exif: false,
    });

    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return { status: 'cancelled' };

    const isVideo =
      asset.type === 'video' || (asset.mimeType?.startsWith('video/') ?? false);
    return isVideo ? prepareVideo(asset) : await prepareImage(asset);
  } catch {
    return { status: 'rejected', message: STORY_MESSAGES.pickerFailed };
  }
}
