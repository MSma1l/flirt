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
export {
  deletePhoto,
  isPhotoUploadError,
  PhotoUploadError,
  reorderPhotos,
  uploadErrorReason,
  uploadPhoto,
} from './photosApi';
export type { PhotoErrorKey, PhotoErrorReason, UploadOptions } from './photosApi';
export { usePhotoErrorText } from './usePhotoErrorText';
export { moveItem } from './reorder';
export type {
  CompressResult,
  LocalPhoto,
  PhotoTile,
  PickedAsset,
  PickPhotoResult,
} from './types';
export {
  IMAGE_PROCESSING_FAILED_MESSAGE,
  PERMISSION_DENIED_MESSAGE,
  PHOTO_LIMITS,
  PICKER_FAILED_MESSAGE,
  validateCanAddPhoto,
  validatePhotoCount,
  validatePhotoSize,
  validateUploadType,
} from './validation';
