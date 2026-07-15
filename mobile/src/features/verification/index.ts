/** Verificare facială (TZ 2.2): captură selfie + comparare la backend. */
export { FaceVerifyError, verifyFace } from './faceApi';
export type { FaceVerification } from './faceApi';
export { captureSelfie } from './faceCamera';
export type { SelfieCamera, SelfieCaptureResult } from './faceCamera';
export {
  CAMERA_PERMISSION_BLOCKED_MESSAGE,
  CAMERA_PERMISSION_MESSAGE,
  CAPTURE_FAILED_MESSAGE,
  FACE_MESSAGES,
  faceVerifyMessage,
  faceVerifyReason,
} from './messages';
export type { FaceVerifyReason } from './messages';
