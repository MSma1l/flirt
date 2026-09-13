/**
 * Verificarea prin selfie în Telegram Mini App (TZ 2.2).
 *
 * DOUĂ CĂI DE CAPTURĂ, alese prin ÎNCERCARE, nu după numele platformei:
 *   1. în pagină — `getUserMedia` + `<video>` oglindit + buton de fotografiere,
 *      cu posibilitatea de a reface poza înainte de trimitere;
 *   2. rezervă — `<input type="file" accept="image/*" capture="user">`, care pe
 *      telefon deschide direct camera, iar pe desktop selectorul de fișiere.
 *
 * Calea 1 poate cădea în patru locuri diferite, și le tratăm pe toate:
 * `mediaDevices` lipsește, permisiunea e refuzată, nu există cameră, fluxul nu
 * pornește (vezi `selfieCamera.ts`). La oricare dintre ele trecem pe calea 2 —
 * și NU mai cerem permisiunea a doua oară, ca utilizatorul care a refuzat o dată
 * să nu intre într-o buclă de dialoguri.
 *
 * CE NU FACE ecranul: nu cheamă `alert()` / `confirm()` (blochează WebView-ul
 * Telegram — orice mesaj e text pe ecran) și nu trimite NIMIC pe rețea până
 * când utilizatorul nu apasă butonul de trimitere.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { StatusScreen } from '@/components/StatusScreen';
import { browserIo } from '@/features/onboarding/imageCompress';
import { PROFILE_PATH } from '@/features/onboarding/paths';
import { fetchMyProfile } from '@/features/profile/profileApi';

import { FaceVerifyError, verifyFace, type FaceVerifyReason } from './faceVerifyApi';
import {
  captureFrame,
  isCameraSupported,
  openSelfieStream,
  probeCameraPermission,
  stopStream,
  waitForVideo,
} from './selfieCamera';
import { prepareSelfie } from './selfieUpload';

import './verification.css';

/** Pasul la care se află fluxul. */
type Stage = 'intro' | 'camera' | 'review' | 'result';

/**
 * Ce s-a întâmplat cu camera, ca și cheie de traducere.
 *
 * `permissionBlocked` și `captureFailed` vin din catalogul mobil (`verification`),
 * deja traduse; „camera nu e disponibilă aici" e un caz pe care aplicația nativă
 * nu-l are (acolo camera există întotdeauna), deci textul lui stă în `screens`.
 */
type CameraNotice = 'permissionBlocked' | 'captureFailed' | 'unavailable';

/** Motivele la care sfaturile („lumină", „încadrare", „ochelari") chiar ajută. */
const REASONS_WITH_TIPS: ReadonlySet<FaceVerifyReason> = new Set<FaceVerifyReason>([
  'no_match',
  'no_face',
  'invalid_image',
]);

/** Selfie-ul pregătit, ținut până la apăsarea butonului de trimitere. */
interface Shot {
  blob: Blob;
  fileName: string;
  previewUrl: string;
}

export function VerificationScreen() {
  const { t } = useTranslation(['screens', 'verification', 'common', 'profile']);
  const queryClient = useQueryClient();

  // Aceeași cheie ca în `ProfileScreen`: cache-ul e comun, deci intrarea în
  // ecran nu mai face o cerere dacă profilul a fost deja citit.
  const profileQuery = useQuery({ queryKey: ['my-profile'], queryFn: fetchMyProfile });
  const profile = profileQuery.data ?? null;

  const [stage, setStage] = useState<Stage>('intro');
  const [shot, setShot] = useState<Shot | null>(null);
  const [reason, setReason] = useState<FaceVerifyReason | null>(null);
  const [notice, setNotice] = useState<CameraNotice | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Camera a fost deja refuzată / lipsește. Cât ține ecranul, nu mai cerem —
   * asta e regula care ține utilizatorul în afara buclei de cereri.
   */
  const [cameraBlocked, setCameraBlocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  /** Oprește fluxul și desface legătura cu `<video>`. Idempotentă. */
  const stopCamera = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  /** Eliberează `blob:`-ul previzualizării (altfel rămâne alocat până la reload). */
  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }, []);

  /*
   * CAMERA SE OPREȘTE LA IEȘIRE. Două căi, fiindcă sunt două feluri de a pleca:
   *  - demontarea componentei (navigare în aplicație) — curățarea de mai jos;
   *  - închiderea / ascunderea Mini App-ului, când demontarea nu se mai
   *    întâmplă — `pagehide`.
   * Fără ele, indicatorul de cameră al dispozitivului rămâne aprins și
   * utilizatorul crede, pe bună dreptate, că e filmat în continuare.
   */
  useEffect(() => {
    const onHide = () => stopCamera();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      stopCamera();
      releasePreview();
    };
  }, [stopCamera, releasePreview]);

  /** Trece definitiv pe calea a doua și spune de ce. */
  const fallbackTo = useCallback((why: CameraNotice, openPicker: boolean) => {
    setCameraBlocked(true);
    setNotice(why);
    setStage('intro');
    // Deschidem selectorul singuri doar când NU tocmai am fost refuzați: după un
    // dialog de permisiune închis cu „nu", un al doilea dialog care sare din
    // senin arată a defecțiune. Butonul rămâne oricum pe ecran, lângă explicație.
    if (openPicker) fileRef.current?.click();
  }, []);

  /** Leagă fluxul de `<video>` și verifică dacă CHIAR pornește. */
  useEffect(() => {
    if (stage !== 'camera') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    let cancelled = false;
    video.srcObject = stream;
    // `play()` poate fi respins de politica de autoplay; `waitForVideo` rămâne
    // sursa de adevăr pentru „a pornit sau nu".
    void video.play?.()?.catch(() => undefined);

    void waitForVideo(video).then((ready) => {
      if (cancelled || ready) return;
      stopCamera();
      fallbackTo('unavailable', true);
    });

    return () => {
      cancelled = true;
    };
  }, [stage, stopCamera, fallbackTo]);

  /** Poza aleasă/făcută → micșorare → previzualizare. Nimic pe rețea încă. */
  const acceptImage = useCallback(
    async (blob: Blob) => {
      setBusy(true);
      try {
        const prepared = await prepareSelfie(blob, browserIo);
        if (!prepared.ok) {
          releasePreview();
          setShot(null);
          setVerified(null);
          setReason(prepared.reason);
          setStage('result');
          return;
        }
        releasePreview();
        const previewUrl = URL.createObjectURL(prepared.blob);
        previewUrlRef.current = previewUrl;
        setShot({ blob: prepared.blob, fileName: prepared.fileName, previewUrl });
        setReason(null);
        setNotice(null);
        setStage('review');
      } finally {
        setBusy(false);
      }
    },
    [releasePreview],
  );

  /** Butonul principal: încearcă prima cale, altfel trece pe a doua. */
  const handleStart = useCallback(async () => {
    setReason(null);
    setNotice(null);

    if (cameraBlocked) {
      fileRef.current?.click();
      return;
    }

    if (!isCameraSupported()) {
      fallbackTo('unavailable', true);
      return;
    }

    setBusy(true);
    try {
      // Dacă browserul știe deja că a fost refuzat, nu mai cerem: ar fi exact
      // bucla pe care o evităm.
      if ((await probeCameraPermission()) === 'denied') {
        fallbackTo('permissionBlocked', false);
        return;
      }

      const access = await openSelfieStream();
      if (!access.ok) {
        fallbackTo(access.reason === 'denied' ? 'permissionBlocked' : 'unavailable', access.reason !== 'denied');
        return;
      }

      streamRef.current = access.stream;
      setStage('camera');
    } finally {
      setBusy(false);
    }
  }, [cameraBlocked, fallbackTo]);

  /** Fotografiază din fluxul viu. Cadrul NU e oglindit — vezi `captureFrame`. */
  const handleShoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const frame = await captureFrame(video);
    stopCamera();
    if (!frame) {
      setNotice('captureFailed');
      setStage('intro');
      return;
    }
    await acceptImage(frame);
  }, [acceptImage, stopCamera]);

  const handleCancelCamera = useCallback(() => {
    stopCamera();
    setStage('intro');
  }, [stopCamera]);

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Aceeași poză aleasă a doua oară nu ar mai declanșa `change` fără asta.
      event.target.value = '';
      if (file) await acceptImage(file);
    },
    [acceptImage],
  );

  /** SINGURUL loc din ecran care atinge rețeaua de verificare. */
  const handleSend = useCallback(async () => {
    if (!shot) return;
    setBusy(true);
    setReason(null);
    try {
      const verdict = await verifyFace(shot.blob, shot.fileName);
      setVerified(verdict.verified);
      // Verdictul negativ NU e o eroare de transport: backendul întoarce
      // `verified=false` și pentru „nu semeni cu pozele tale", și pentru
      // „profilul n-are poze de referință" (`services/face_verify.py`,
      // `RekognitionFaceVerifier.compare` → `(False, 0.0)`). `no_match` e
      // formularea care acoperă onest ambele, fără să afirme ce nu știm.
      if (!verdict.verified) setReason('no_match');
      // Badge-ul de pe profil se citește din `Profile.verified`, pe care ruta
      // tocmai l-a rescris.
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    } catch (error) {
      setVerified(false);
      setReason(error instanceof FaceVerifyError ? error.reason : 'unknown');
    } finally {
      setBusy(false);
      setStage('result');
    }
  }, [shot, queryClient]);

  /** Înapoi la început: refacem poza sau reîncercăm după un eșec. */
  const handleRestart = useCallback(() => {
    releasePreview();
    setShot(null);
    setVerified(null);
    setReason(null);
    setNotice(null);
    setStage('intro');
  }, [releasePreview]);

  /* ------------------------------- Stările ------------------------------- */

  if (profileQuery.isLoading) {
    return (
      <StatusScreen
        loading
        logo={false}
        testId="status-verify-loading"
        title={t('profile:edit.loading')}
      />
    );
  }

  const photoCount = profile?.photos.length ?? 0;
  const backToProfile = (
    <Link className="button button--ghost" to={PROFILE_PATH} data-testid="verify-back">
      {t('screens:verification.backToProfile')}
    </Link>
  );

  // Deja verificat: nu are rost să-l mai trecem o dată prin flux.
  if (profile?.verified || verified === true) {
    return (
      <div className="verify-screen">
        <h1 className="title">{t('verification:title')}</h1>
        <p className="verify-verified" data-testid="verify-done">
          {t('verification:verified')}
        </p>
        <p className="body-text">{t('screens:verification.successBody')}</p>
        {backToProfile}
      </div>
    );
  }

  // Fără poze de referință nu are cu ce compara. Îi spunem înainte să apese,
  // nu după ce trimite degeaba un selfie.
  if (profileQuery.isSuccess && photoCount === 0) {
    return (
      <div className="verify-screen">
        <h1 className="title">{t('verification:title')}</h1>
        <p className="error-text" data-testid="verify-no-photos">
          {t('verification:reasons.no_profile')}
        </p>
        {backToProfile}
      </div>
    );
  }

  return (
    <div className="verify-screen">
      <h1 className="title">{t('verification:title')}</h1>

      {stage === 'intro' ? (
        <>
          <p className="body-text">{t('verification:intro')}</p>

          {/* CONFIDENȚIALITATE, înainte de orice buton: selfie-ul pleacă spre
              server. Textul spune exact ce se întâmplă cu el — vezi catalogul. */}
          <section className="verify-privacy" data-testid="verify-privacy">
            <h2 className="verify-privacy__title">{t('screens:verification.privacyTitle')}</h2>
            <p className="verify-privacy__body">{t('screens:verification.privacy')}</p>
          </section>

          {notice ? (
            <p className="caption" data-testid="verify-notice">
              {notice === 'unavailable'
                ? t('screens:verification.cameraUnavailable')
                : t(`verification:camera.${notice}`)}
            </p>
          ) : null}

          <button
            type="button"
            className="button"
            data-testid="verify-start"
            onClick={() => void handleStart()}
            disabled={busy}
          >
            {t('verification:start')}
          </button>

          {/* Calea a doua, mereu la vedere: dacă prima e blocată, nimeni nu
              rămâne fără drum înainte. */}
          <button
            type="button"
            className="button button--ghost"
            data-testid="verify-choose"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {t('screens:verification.choose')}
          </button>
        </>
      ) : null}

      {stage === 'camera' ? (
        <>
          <div className="verify-camera">
            {/* `verify-camera__video` aplică `scaleX(-1)`: previzualizarea e
                oglindită fiindcă așa se așteaptă omul să se vadă. Cadrul TRIMIS
                nu e oglindit (vezi `captureFrame`). */}
            <video
              ref={videoRef}
              className="verify-camera__video"
              data-testid="verify-video"
              autoPlay
              muted
              playsInline
            />
          </div>
          <p className="caption">{t('verification:framingHint')}</p>

          <button
            type="button"
            className="button"
            data-testid="verify-shoot"
            onClick={() => void handleShoot()}
            disabled={busy}
          >
            {t('screens:verification.shoot')}
          </button>
          <button
            type="button"
            className="button button--ghost"
            data-testid="verify-cancel"
            onClick={handleCancelCamera}
          >
            {t('common:actions.cancel')}
          </button>
        </>
      ) : null}

      {stage === 'review' && shot ? (
        <>
          <img
            className="verify-preview"
            src={shot.previewUrl}
            alt={t('screens:verification.a11y.shot')}
            data-testid="verify-preview"
          />
          <p className="caption">{t('screens:verification.reviewNote')}</p>

          <button
            type="button"
            className="button"
            data-testid="verify-send"
            onClick={() => void handleSend()}
            disabled={busy}
          >
            {busy ? t('screens:verification.sending') : t('screens:verification.send')}
          </button>
          <button
            type="button"
            className="button button--ghost"
            data-testid="verify-retake"
            onClick={handleRestart}
            disabled={busy}
          >
            {t('screens:verification.retake')}
          </button>
        </>
      ) : null}

      {stage === 'result' ? (
        <>
          <h2 className="verify-result__title" data-testid="verify-result-title">
            {t('screens:verification.failTitle')}
          </h2>
          <p className="error-text" data-testid="verify-reason">
            {t(`verification:reasons.${reason ?? 'unknown'}`)}
          </p>

          {reason && REASONS_WITH_TIPS.has(reason) ? (
            <section className="verify-tips" data-testid="verify-tips">
              <h3 className="verify-tips__title">{t('screens:verification.tipsTitle')}</h3>
              <ul className="verify-tips__list">
                <li>{t('screens:verification.tips.light')}</li>
                <li>{t('screens:verification.tips.frame')}</li>
                <li>{t('screens:verification.tips.sunglasses')}</li>
              </ul>
            </section>
          ) : null}

          <button
            type="button"
            className="button"
            data-testid="verify-retry"
            onClick={handleRestart}
          >
            {t('common:actions.retry')}
          </button>
          {backToProfile}
        </>
      ) : null}

      {/* Calea a doua. `capture="user"` cere camera FRONTALĂ pe telefon; pe
          desktop atributul e ignorat și se deschide selectorul de fișiere —
          exact comportamentul dorit în ambele locuri. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        className="verify-file"
        data-testid="verify-file"
        onChange={(event) => void handleFile(event)}
      />
    </div>
  );
}

export default VerificationScreen;
