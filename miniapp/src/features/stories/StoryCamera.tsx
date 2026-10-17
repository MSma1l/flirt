/**
 * Cameră live pentru story în Mini App. Când WebView-ul nu expune camera,
 * ecranul rămâne util: utilizatorul poate deschide galeria/camera nativă.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onCapture: (file: File) => void;
  onPickGallery: () => void;
  onClose: () => void;
}

function cameraUnavailable(): boolean {
  return !navigator.mediaDevices?.getUserMedia;
}

export function StoryCamera({ onCapture, onPickGallery, onClose }: Props) {
  const { t } = useTranslation(['stories', 'common']);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
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
        if (videoRef.current) videoRef.current.srcObject = stream;
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
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture(new File([blob], `story-camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  return (
    <section className="st-camera" aria-label={t('stories:compose.title')}>
      {state === 'ready' ? <video ref={videoRef} className="st-camera__video" autoPlay playsInline muted /> : null}
      <header className="st-camera__top">
        <button type="button" className="st-camera__icon" onClick={onClose} aria-label={t('common:actions.close')}>✕</button>
      </header>
      {state !== 'ready' ? <p className="st-camera__notice">{t('stories:messages.cameraUnavailable')}</p> : null}
      <div className="st-camera__controls">
        <button type="button" className="st-camera__side" onClick={onPickGallery} aria-label={t('stories:camera.gallery')}>🖼️</button>
        <button type="button" className="st-camera__shutter" onClick={capture} disabled={state !== 'ready'} aria-label={t('stories:camera.capture')}><span /></button>
        <button type="button" className="st-camera__side" onClick={() => setFacing((value) => (value === 'user' ? 'environment' : 'user'))} disabled={state !== 'ready'} aria-label={t('stories:camera.flip')}>🔄</button>
      </div>
    </section>
  );
}

export default StoryCamera;
