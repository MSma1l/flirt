/**
 * Alegerea POZEI unui story din galerie + pregătirea ei pentru upload
 * (TZ secț. 11), stil Instagram.
 *
 * Un story e doar o poză: galeria se deschide filtrată pe imagini (`mediaTypes:
 * ['images']`). Video-ul e scos deliberat — nu-l putem modera automat, iar Apple
 * Guideline 1.2 cere filtrarea conținutului obiecționabil; backend-ul refuză oricum
 * orice upload de video cu 422.
 *
 * Pozele trec prin ACEEAȘI compresie ca pozele de profil (`compressPhoto` din
 * `features/photos`, singurul loc cu limitele de upload) — un JPEG de pe un telefon
 * modern ar lua altfel 413.
 */
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import { compressPhoto, ensureLibraryPermission } from '@/features/photos';

import { StoryMediaFile } from './storiesApi';
import { STORY_MESSAGES } from './storyLimits';

/** Rezultatul alegerii unei poze — nu aruncă niciodată. */
export type PickStoryResult =
  /** Poza aleasă, validată/comprimată — gata de upload. */
  | { status: 'picked'; file: StoryMediaFile }
  /** Utilizatorul a închis galeria fără să aleagă. */
  | { status: 'cancelled' }
  /** Permisiune refuzată; `canAskAgain=false` → doar ecranul de Setări mai ajută. */
  | { status: 'denied'; canAskAgain: boolean }
  /** Poză respinsă local (prea mare) sau galeria a eșuat. */
  | { status: 'rejected'; message: string };

/** Deschide ecranul de Setări al aplicației (calea de recuperare după refuz). */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}

/** Pregătește o poză aleasă: compresie (reia logica pozelor de profil). */
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
 * Deschide galeria (DOAR imagini) și întoarce poza gata de upload.
 *
 * Nu aruncă: orice eșec (permisiune, poză prea mare, eroare de sistem) devine un
 * rezultat explicit, ca ecranul să afișeze un mesaj și o cale de recuperare în loc
 * să crape.
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
      // Doar imagini: video-ul nu e moderabil automat (Guideline 1.2).
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1, // comprimăm NOI pozele, controlat, mai jos
      exif: false,
    });

    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return { status: 'cancelled' };

    return await prepareImage(asset);
  } catch {
    return { status: 'rejected', message: STORY_MESSAGES.pickerFailed };
  }
}
