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
 *
 * ZOOM. Pinch cu două degete pe previzualizare sau butoanele 1× / 2× / 3×.
 * Dacă pista video expune `zoom` (Chrome pe Android) folosim zoom-ul REAL al
 * camerei (`applyConstraints`); altfel (iOS, desktop) zoom DIGITAL: CSS
 * `scale` pe previzualizare + decupajul aceleiași regiuni centrale la captură,
 * ca poza să fie exact ce s-a văzut. Matematica e în `cameraZoom.ts`.
 */
import { useEffect, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DIGITAL_RANGE,
  clampZoom,
  digitalCropRect,
  formatZoom,
  hardwareZoomRange,
  initialZoom,
  pinchZoom,
  previewTransform,
  snapZoom,
  touchDistance,
  zoomPresets,
  type ZoomRange,
} from './cameraZoom';

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
  const { t } = useTranslation(['stories', 'common', 'screens']);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [mirrored, setMirrored] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(
    cameraUnavailable() ? 'unavailable' : 'loading',
  );
  const [zoomRange, setZoomRange] = useState<ZoomRange>(DIGITAL_RANGE);
  const [zoom, setZoom] = useState(1);
  // Pinch în curs: zoom-ul și distanța dintre degete de la începutul gestului.
  const pinchRef = useRef<{ startZoom: number; startDistance: number } | null>(null);
  // Zoom hardware: `applyConstraints` e asincron — un singur apel în zbor,
  // ultima valoare cerută se aplică după (pinch-ul trimite zeci pe secundă).
  const hwPendingRef = useRef<number | null>(null);
  const hwBusyRef = useRef(false);

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
        // Fiecare cameră are alt interval de zoom: îl citim din pista nouă și
        // pornim de la 1× (și la întoarcerea camerei).
        const track = stream.getVideoTracks?.()[0] ?? null;
        trackRef.current = track;
        const range = hardwareZoomRange(track) ?? DIGITAL_RANGE;
        hwPendingRef.current = null;
        setZoomRange(range);
        setZoom(initialZoom(range));
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
      trackRef.current = null;
    };
  }, [facing]);

  const applyHardwareZoom = (value: number) => {
    hwPendingRef.current = value;
    if (hwBusyRef.current) return;
    const track = trackRef.current;
    if (!track?.applyConstraints) return;
    const next = hwPendingRef.current;
    hwPendingRef.current = null;
    hwBusyRef.current = true;
    // `zoom` nu e (încă) în tipurile DOM ale TypeScript.
    const constraints = { advanced: [{ zoom: next } as MediaTrackConstraintSet] };
    track
      .applyConstraints(constraints)
      .catch(() => {
        // Camera a refuzat (API declarat, dar nefuncțional): trecem pe digital.
        hwPendingRef.current = null;
        setZoomRange(DIGITAL_RANGE);
        setZoom((current) => clampZoom(current, DIGITAL_RANGE.min, DIGITAL_RANGE.max));
      })
      .finally(() => {
        hwBusyRef.current = false;
        const pending = hwPendingRef.current;
        if (pending !== null && trackRef.current === track) applyHardwareZoom(pending);
      });
  };

  const changeZoom = (value: number) => {
    const next = snapZoom(value, zoomRange);
    setZoom(next);
    if (zoomRange.mode === 'hardware') applyHardwareZoom(next);
  };

  const onTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    if (state !== 'ready' || event.touches.length !== 2) return;
    pinchRef.current = {
      startZoom: zoom,
      startDistance: touchDistance(event.touches[0]!, event.touches[1]!),
    };
  };

  const onTouchMove = (event: ReactTouchEvent<HTMLElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2) return;
    const distance = touchDistance(event.touches[0]!, event.touches[1]!);
    changeZoom(pinchZoom(pinch.startZoom, pinch.startDistance, distance, zoomRange));
  };

  const onTouchEnd = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length < 2) pinchRef.current = null;
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    const digitalZoom = zoomRange.mode === 'digital' && zoom > 1;
    const crop = digitalZoom
      ? digitalCropRect(video.videoWidth, video.videoHeight, zoom)
      : null;
    canvas.width = crop ? crop.sw : video.videoWidth;
    canvas.height = crop ? crop.sh : video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    // Cadrul se desenează EXACT cum vine de la cameră, fără `scale(-1, 1)`:
    // oglindirea previzualizării e doar CSS (vezi antetul fișierului), iar poza
    // publicată trebuie să fie cea reală, neoglindită. La zoom digital se
    // desenează doar regiunea centrală văzută pe ecran (rezoluția ei nativă, fără
    // mărire artificială); la zoom hardware cadrul e deja mărit de cameră.
    if (crop) {
      context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
    } else {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture(new File([blob], `story-camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  const unavailable = state === 'unavailable';
  const nativeFallback = unavailable && Boolean(onNativeCamera);
  const presets = zoomPresets(zoomRange);
  // Butonul activ = cea mai mare treaptă ≤ zoom-ul curent; afișează valoarea
  // reală (ex. „1.6×" după un pinch), ca în aplicația de cameră.
  const activePreset = presets.filter((p) => p <= zoom + 0.05).pop() ?? presets[0];
  const transform = previewTransform(zoom, mirrored, zoomRange.mode);

  return (
    <section
      className="st-camera"
      aria-label={t('stories:compose.title')}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <video
        ref={videoRef}
        className={`st-camera__video${mirrored ? ' st-camera__video--mirrored' : ''}`}
        data-testid="story-camera-video"
        data-mirrored={mirrored ? 'true' : 'false'}
        data-zoom={zoom}
        data-zoom-mode={zoomRange.mode}
        style={transform ? { transform } : undefined}
        hidden={state !== 'ready'}
        autoPlay
        playsInline
        muted
      />
      <header className="st-camera__top">
        <button type="button" className="st-camera__icon" onClick={onClose} aria-label={t('common:actions.close')}>✕</button>
      </header>
      {unavailable ? <p className="st-camera__notice">{t('stories:messages.cameraUnavailable')}</p> : null}
      {state === 'ready' && presets.length > 1 ? (
        <div className="st-camera__zoom" role="group" aria-label={t('screens:stories.camera.zoom')}>
          {presets.map((preset) => {
            const active = preset === activePreset;
            return (
              <button
                key={preset}
                type="button"
                className={`st-camera__zoom-btn${active ? ' st-camera__zoom-btn--active' : ''}`}
                data-testid={`story-camera-zoom-${preset}`}
                aria-pressed={active}
                aria-label={t('screens:stories.camera.zoomTo', { value: formatZoom(preset) })}
                onClick={() => changeZoom(preset)}
              >
                {formatZoom(active ? zoom : preset)}×
              </button>
            );
          })}
        </div>
      ) : null}
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
