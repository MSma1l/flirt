/**
 * Verificarea prin selfie (TZ 2.2): captură, micșorare, trimitere, verdict.
 *
 * INTRAREA în flux e `VerificationGate`, nu `VerificationScreen`: poarta
 * întreabă serverul dacă funcția e reală și abia apoi montează fluxul.
 */
export { VerificationGate } from './VerificationGate';
export { VerificationScreen } from './VerificationScreen';
export { VERIFICATION_PATH } from './verificationRoutes';
export { FaceVerifyError, verifyFace } from './faceVerifyApi';
export type { FaceVerification, FaceVerifyReason } from './faceVerifyApi';
export { prepareSelfie } from './selfieUpload';
export type { PreparedSelfie } from './selfieUpload';
export {
  captureFrame,
  classifyCameraError,
  isCameraSupported,
  openSelfieStream,
  probeCameraPermission,
  stopStream,
  waitForVideo,
} from './selfieCamera';
export type { CameraAccess, CameraFailure, CameraPermission } from './selfieCamera';
