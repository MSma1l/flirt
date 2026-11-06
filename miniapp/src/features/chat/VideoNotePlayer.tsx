/**
 * Mesajul video rotund („кружок", ca în Telegram) din bulă: un cerc de ~220px.
 *
 * Două moduri, ca în Telegram:
 *  - PREVIZUALIZARE: cât timp cercul e pe ecran, video-ul rulează FĂRĂ SUNET, în
 *    buclă (`muted` + `playsInline` = singura redare automată permisă de iOS).
 *    Iese de pe ecran → pauză (nu descărcăm / decodăm ce nu se vede). Fără
 *    redare automată la „Economisire date", „reducere animații" sau fără
 *    `IntersectionObserver` — atunci se vede primul cadru (`#t=0.1`).
 *  - CU SUNET: ATINGEREA pornește de la început, cu sunet; inelul arată
 *    progresul, eticheta — timpul curent. Încă o atingere = pauză / continuare.
 *    La final (sau când pornește alt mesaj video / un vocal) revine în
 *    previzualizare. Un singur mesaj cu sunet pe pagină; ieșit de pe ecran → pauză.
 *
 * Fișierul vine de la server ca MP4 H.264/AAC pătrat (redabil pe iOS și
 * Android). Dacă totuși nu se poate reda (ex. WebM vechi pe iPhone), cercul
 * arată un mesaj clar; atingerea reîncearcă (`load()`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatIcon } from './ChatIcons';
import { formatDuration } from './chatMedia';
import { preparePlaybackSession } from './VoicePlayer';
import './videoNote.css';

interface Props {
  src: string;
  durationMs: number | null;
  /** Bula optimistă (upload în curs): fără redare. */
  disabled?: boolean;
}

/** Evenimentul pe `document` când un mesaj video pornește cu sunet. */
export const VIDEO_NOTE_SOUND_EVENT = 'flirt:video-note-sound';

/** Cât din cerc trebuie să fie pe ecran ca să ruleze. */
const VISIBLE_RATIO = 0.5;

/** Redarea automată (fără sunet) e permisă pe dispozitivul ăsta? */
function autoplayAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
    return false;
  }
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return false;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {
    /* matchMedia indisponibil */
  }
  return true;
}

function ignore() {
  /* promisiunea lui `play()` respinsă intenționat (pauză, politica de autoplay) */
}

export function VideoNotePlayer({ src, durationMs, disabled = false }: Props) {
  const { t } = useTranslation(['screens']);
  const rootRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Modul „cu sunet" (și pe pauză); altfel previzualizare. */
  const soundRef = useRef(false);
  const visibleRef = useRef(false);
  const failedRef = useRef(false);
  const [sound, setSound] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [progress, setProgress] = useState(0);
  const [mediaMs, setMediaMs] = useState<number | null>(null);

  const markFailed = useCallback((value: boolean) => {
    failedRef.current = value;
    setFailed(value);
  }, []);

  /** Bucla fără sunet, dacă cercul e pe ecran și redarea automată e permisă. */
  const startPreview = useCallback(() => {
    const el = videoRef.current;
    if (!el || disabled || !src || soundRef.current || failedRef.current) return;
    if (!visibleRef.current || !autoplayAllowed()) return;
    el.muted = true;
    el.loop = true;
    try {
      const result = el.play();
      if (result && typeof result.catch === 'function') result.catch(ignore);
    } catch {
      /* WebView fără redare automată: rămâne primul cadru */
    }
  }, [disabled, src]);

  /** Ieșirea din modul „cu sunet": înapoi la previzualizare, de la început. */
  const exitSound = useCallback(() => {
    const el = videoRef.current;
    soundRef.current = false;
    setSound(false);
    setPlaying(false);
    setProgress(0);
    setCurrentMs(0);
    if (!el) return;
    el.pause();
    el.muted = true;
    el.loop = true;
    try {
      el.currentTime = 0;
    } catch {
      /* unele WebView-uri refuză derularea înainte de metadate */
    }
    startPreview();
  }, [startPreview]);

  // Pe ecran → previzualizare; în afara lui → pauză (și cu sunet).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window.IntersectionObserver !== 'function') return;
    // Abonare nouă (ex. bula optimistă a devenit mesaj): primul raport decide.
    visibleRef.current = false;
    const observer = new window.IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
        if (visible === visibleRef.current) return;
        visibleRef.current = visible;
        const el = videoRef.current;
        if (!el) return;
        if (!visible) {
          if (!el.paused) el.pause();
        } else if (!soundRef.current) {
          startPreview();
        }
      },
      { threshold: [0, VISIBLE_RATIO, 1] },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [startPreview]);

  // Un singur mesaj cu sunet: alt „кружок" sau un vocal pornit → revenim.
  useEffect(() => {
    const onOtherNote = (event: Event) => {
      if ((event as CustomEvent).detail !== videoRef.current && soundRef.current) exitSound();
    };
    // `play` nu urcă prin DOM → ascultăm în faza de captură.
    const onAnyPlay = (event: Event) => {
      if (event.target instanceof HTMLAudioElement && soundRef.current) exitSound();
    };
    document.addEventListener(VIDEO_NOTE_SOUND_EVENT, onOtherNote);
    document.addEventListener('play', onAnyPlay, true);
    return () => {
      document.removeEventListener(VIDEO_NOTE_SOUND_EVENT, onOtherNote);
      document.removeEventListener('play', onAnyPlay, true);
    };
  }, [exitSound]);

  const playWithSound = (el: HTMLVideoElement) => {
    // `play()` SINCRON în handlerul de atingere: iOS dă sunet doar dintr-un gest.
    try {
      const result = el.play();
      // Deja în buclă (previzualizare) → fără un nou eveniment `play`.
      setPlaying(!el.paused);
      if (result && typeof result.catch === 'function') {
        result.catch((e: unknown) => {
          const name = (e as { name?: string } | null)?.name;
          // `AbortError` = întrerupt de o pauză (alt mesaj pornit) — nu e o eroare.
          if (name === 'AbortError') return;
          if (name === 'NotAllowedError') {
            // Politica WebView-ului a refuzat sunetul: înapoi la previzualizare.
            exitSound();
            return;
          }
          soundRef.current = false;
          setSound(false);
          setPlaying(false);
          markFailed(true);
        });
      }
    } catch {
      markFailed(true);
    }
  };

  const toggle = () => {
    const el = videoRef.current;
    if (!el || disabled || !src) return;

    if (soundRef.current) {
      if (!el.paused && !el.ended) el.pause();
      else playWithSound(el);
      return;
    }

    // Intrarea în modul cu sunet: oprim vocalele și celelalte „кружки".
    document.querySelectorAll('audio').forEach((audio) => {
      if (!audio.paused) audio.pause();
    });
    document.dispatchEvent(new CustomEvent(VIDEO_NOTE_SOUND_EVENT, { detail: el }));
    preparePlaybackSession();
    if (failedRef.current || el.error) {
      // Reîncercare: `load()` resetează elementul (iOS rămâne pe eroarea veche).
      markFailed(false);
      el.load?.();
    } else {
      try {
        el.currentTime = 0;
      } catch {
        /* înainte de metadate */
      }
    }
    soundRef.current = true;
    setSound(true);
    setPreviewing(false);
    setProgress(0);
    setCurrentMs(0);
    el.loop = false;
    el.muted = false;
    playWithSound(el);
  };

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (!el || !soundRef.current) return;
    setCurrentMs(el.currentTime * 1000);
    const total =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : (durationMs ?? 0);
    setProgress(total > 0 ? Math.min(1, (el.currentTime * 1000) / total) : 0);
  };

  const onLoadedMetadata = () => {
    const el = videoRef.current;
    if (el && Number.isFinite(el.duration) && el.duration > 0) setMediaMs(el.duration * 1000);
  };

  const onPlay = () => {
    if (soundRef.current) setPlaying(true);
    else setPreviewing(true);
  };

  const onPause = () => {
    setPlaying(false);
    setPreviewing(false);
  };

  const onEnded = () => {
    if (soundRef.current) exitSound();
  };

  const onError = () => {
    // Bula optimistă (fișierul local, încă în upload) nu arată eroarea.
    if (disabled) return;
    soundRef.current = false;
    setSound(false);
    setPlaying(false);
    setPreviewing(false);
    markFailed(true);
  };

  const r = 48;
  const c = 2 * Math.PI * r;
  const totalMs = durationMs ?? mediaMs;
  const label = sound ? formatDuration(currentMs) : formatDuration(totalMs);
  const state = failed
    ? 'failed'
    : sound
      ? playing
        ? 'sound'
        : 'paused'
      : previewing
        ? 'preview'
        : 'idle';

  return (
    <button
      ref={rootRef}
      type="button"
      className={sound ? 'video-note video-note--playing' : 'video-note'}
      data-testid="video-note"
      data-state={state}
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
        muted
        playsInline
        disablePictureInPicture
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onError={onError}
      />
      {sound ? (
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
      {/* Butonul mare de redare doar pe cadrul static / pauză; peste bucla
          fără sunet stă doar indicatorul mic „fără sunet", ca în Telegram. */}
      {!playing && (!previewing || failed) ? (
        <span className="video-note__play" aria-hidden="true">
          <ChatIcon name={failed ? 'alert' : 'play'} size={24} />
        </span>
      ) : null}
      <span className="video-note__badge" data-testid="video-note-duration">
        {previewing && !sound ? (
          <svg
            className="video-note__muted-icon"
            viewBox="0 0 24 24"
            width="11"
            height="11"
            aria-hidden="true"
          >
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
        ) : null}
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
