/**
 * Mesajul video rotund („кружок", ca în Telegram) din bulă: un cerc de ~220px
 * cu primul cadru ca previzualizare. ATINGEREA pornește redarea cu sunet;
 * încă o atingere o pune pe pauză. Inelul arată progresul, eticheta — durata
 * (sau timpul curent, în timpul redării).
 *
 * Fără redare automată: într-o conversație lungă ar descărca toate video-urile.
 * Fișierul vine de la server ca MP4 H.264/AAC pătrat (redabil pe iOS și Android).
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatIcon } from './ChatIcons';
import { formatDuration } from './chatMedia';

interface Props {
  src: string;
  durationMs: number | null;
  /** Bula optimistă (upload în curs): fără redare. */
  disabled?: boolean;
}

export function VideoNotePlayer({ src, durationMs, disabled = false }: Props) {
  const { t } = useTranslation(['screens']);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [progress, setProgress] = useState(0);

  const toggle = () => {
    const el = videoRef.current;
    if (!el || disabled) return;
    if (!el.paused && !el.ended) {
      el.pause();
      return;
    }
    setFailed(false);
    el.muted = false;
    try {
      const result = el.play();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          setPlaying(false);
          setFailed(true);
        });
      }
    } catch {
      setFailed(true);
    }
  };

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (!el) return;
    setCurrentMs(el.currentTime * 1000);
    const total =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : (durationMs ?? 0);
    setProgress(total > 0 ? Math.min(1, (el.currentTime * 1000) / total) : 0);
  };

  const onEnded = () => {
    setPlaying(false);
    setProgress(0);
    setCurrentMs(0);
    const el = videoRef.current;
    if (el) {
      try {
        el.currentTime = 0;
      } catch {
        /* unele WebView-uri refuză derularea înainte de metadate */
      }
    }
  };

  const r = 48;
  const c = 2 * Math.PI * r;
  const label = playing || currentMs > 0 ? formatDuration(currentMs) : formatDuration(durationMs);

  return (
    <button
      type="button"
      className={playing ? 'video-note video-note--playing' : 'video-note'}
      data-testid="video-note"
      aria-label={playing ? t('screens:chat.videoNote.pause') : t('screens:chat.videoNote.play')}
      aria-pressed={playing}
      disabled={disabled}
      onClick={toggle}
    >
      {/* `#t=0.1` face ca WebView-urile să deseneze primul cadru ca previzualizare. */}
      <video
        ref={videoRef}
        className="video-note__video"
        src={src ? `${src}#t=0.1` : undefined}
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={onEnded}
        onTimeUpdate={onTimeUpdate}
        onError={() => setFailed(true)}
      />
      {playing || progress > 0 ? (
        <svg className="video-note__ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r={r}
            className="video-note__ring-value"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
          />
        </svg>
      ) : null}
      {!playing ? (
        <span className="video-note__play" aria-hidden="true">
          <ChatIcon name={failed ? 'alert' : 'play'} size={24} />
        </span>
      ) : null}
      <span className="video-note__badge" data-testid="video-note-duration">
        {label}
      </span>
      {failed ? (
        <span className="video-note__error" role="alert">
          {t('screens:chat.videoNote.error')}
        </span>
      ) : null}
    </button>
  );
}
