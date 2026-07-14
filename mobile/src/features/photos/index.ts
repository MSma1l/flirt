/** Poze de profil (TZ 2.4): selector din galerie, grilă, upload cu progres. */
export { PhotoGrid } from './PhotoGrid';
export { usePhotoPicker } from './usePhotoPicker';
export type { PhotoPickerApi } from './usePhotoPicker';
export {
  compressPhoto,
  ensureLibraryPermission,
  fileSizeBytes,
  openAppSettings,
  pickPhoto,
} from './photoPicker';
export { deletePhoto, reorderPhotos, uploadPhoto } from './photosApi';
export type { UploadOptions } from './photosApi';
export { moveItem } from './reorder';
export type {
  CompressResult,
  LocalPhoto,
  PhotoTile,
  PickedAsset,
  PickPhotoResult,
} from './types';
export {
  PERMISSION_DENIED_MESSAGE,
  PHOTO_LIMITS,
  validateCanAddPhoto,
  validatePhotoCount,
  validatePhotoSize,
  validateUploadType,
} from './validation';
