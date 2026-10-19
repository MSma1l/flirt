/**
 * Cameră live pentru story în Mini App. Când WebView-ul nu expune camera,
 * ecranul rămâne util: utilizatorul poate deschide galeria sau camera nativă.
 *
 * OGLINDIREA (camera frontală). Previzualizarea live a camerei frontale e
 * OGLINDITĂ, ca în orice aplicație de cameră (îți ridici mâna dreaptă, imaginea
 * o ridică tot pe dreapta) — altfel încadrarea unui selfie pare „pe dos". Poza
 * SALVATĂ însă NU e oglindită: cadrele din `getUserMedia` vin neoglindite (așa
 * cum te văd ceilalți), iar `capture` le desenează pe canvas FĂRĂ nicio
 * transformare. Rezultatul: textul de pe un tricou se citește corect în
 * composer și în povestea publicată — exact ca fotografia reală a camerei
 * native. Oglindirea e doar CSS pe `<video>`, nu atinge pixelii capturați.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onCapture: (file: File) => void;
  onPickGallery: () => void;
  /**
   * Deschide camera NATIVĂ a telefonului (input cu `capture`). Folosită când
   * WebView-ul nu dă acces la camera live (Telegram pe unele Android-uri,
   * permisiune refuzată): declanșatorul rămâne activ și face poza prin sistem.
   */
  onNativeCamera?: () => void;
  onClose: () => void;
}

type Facing = 'user' | 'environment';

function cameraUnavailable(): boolean {
  return !navigator.mediaDevices?.getUserMedia;
}

/**
 * Camera pe care a primit-o EFECTIV fluxul. `facingMode: { ideal }` e doar o
 * preferință: un laptop sau un telefon cu o singură cameră poate întoarce alta.
 * Oglindim după realitate, nu după cerere; fără informație, după cerere.
 */
function actualFacing(stream: MediaStream, requested: Facing): Facing {
  const track = stream.getVideoTracks?.()[0];
  const reported = track?.getSettings?.().facingMode;
  if (reported === 'user' || reported === 'environment') return reported;
  return requested;
}

export function StoryCamera({ onCapture, onPickGallery, onNativeCamera, onClose }: Props) {
  const { t } = useTranslation(['stories', 'common']);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [mirrored, setMirrored] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(
    cameraUnavailable() ? 'unavailable' : 'loading',
  );

  useEffect(() => {
    let cancelled = false;
    const previous = streamRef.current;
    previous?.getTracks().forEach((track) => track.stop());

    if (cameraUnavailable()) return;
    setState('loading');
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setMirrored(actualFacing(stream, facing) === 'user');
        // `<video>` e MEREU montat (doar ascuns până e gata): dacă ar apărea
        // abia la `ready`, aici ref-ul ar fi `null`, fluxul n-ar ajunge la el și
        // camera ar rămâne neagră. iOS cere și `play()` explicit, nu doar
        // `autoPlay`, ca imaginea să pornească în WebView.
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play?.()?.catch(() => undefined);
        }
        setState('ready');
      })
      .catch(() => setState('unavailable'));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    // Cadrul se desenează EXACT cum vine de la cameră, fără `scale(-1, 1)`:
    // oglindirea previzualizării e doar CSS (vezi antetul fișierului), iar poza
    // publicată trebuie să fie cea reală, neoglindită.
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture(new File([blob], `story-camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  const unavailable = state === 'unavailable';
  const nativeFallback = unavailable && Boolean(onNativeCamera);

  return (
    <section className="st-camera" aria-label={t('stories:compose.title')}>
      <video
        ref={videoRef}
        className={`st-camera__video${mirrored ? ' st-camera__video--mirrored' : ''}`}
        data-testid="story-camera-video"
        data-mirrored={mirrored ? 'true' : 'false'}
        hidden={state !== 'ready'}
        autoPlay
        playsInline
        muted
      />
      <header className="st-camera__top">
        <button type="button" className="st-camera__icon" onClick={onClose} aria-label={t('common:actions.close')}>✕</button>
      </header>
      {unavailable ? <p className="st-camera__notice">{t('stories:messages.cameraUnavailable')}</p> : null}
      <div className="st-camera__controls">
        <button
          type="button"
          className="st-camera__side"
          data-testid="story-camera-gallery"
          onClick={onPickGallery}
          aria-label={t('stories:camera.gallery')}
        >
          🖼️
        </button>
        <button
          type="button"
          className="st-camera__shutter"
          data-testid="story-camera-shutter"
          onClick={nativeFallback ? onNativeCamera : capture}
          disabled={state === 'loading' || (unavailable && !nativeFallback)}
          aria-label={t('stories:camera.capture')}
        >
          <span />
        </button>
        <button
          type="button"
          className="st-camera__side"
          data-testid="story-camera-flip"
          onClick={() => setFacing((value) => (value === 'user' ? 'environment' : 'user'))}
          disabled={state !== 'ready'}
          aria-label={t('stories:camera.flip')}
        >
          🔄
        </button>
      </div>
    </section>
  );
}

export default StoryCamera;
