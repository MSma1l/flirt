/** Verificare facială (TZ 2.2): captură selfie + comparare la backend. */
export { FaceVerifyError, verifyFace } from './faceApi';
export type { FaceVerification } from './faceApi';
export { captureSelfie } from './faceCamera';
export type { SelfieCamera, SelfieCaptureResult } from './faceCamera';
export {
  cameraMessage,
  faceVerifyMessage,
  faceVerifyReason,
} from './messages';
export type { FaceVerifyReason } from './messages';
