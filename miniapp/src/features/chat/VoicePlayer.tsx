/**
 * Playerul unui mesaj vocal: buton rotund play/pauză, „undă" din bare (statică,
 * pseudo-aleatoare, derivată din id-ul mesajului — mereu aceeași pentru același
 * mesaj) care se colorează pe măsura progresului, și durata.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatIcon } from './ChatIcons';
import { formatDuration } from './chatMedia';

const BAR_COUNT = 32;

/** Înălțimi 0.2..1 deterministe din `seed` (hash FNV + LCG). */
export function waveformBars(seed: string, count = BAR_COUNT): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const noise = (h % 1000) / 1000;
    // Puțin „anvelopă": capetele mai joase, mijlocul mai plin — arată a voce.
    const envelope = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / count);
    bars.push(Math.max(0.18, Math.min(1, noise * envelope + 0.12)));
  }
  return bars;
}

interface Props {
  id: string;
  src: string;
  durationMs: number | null;
  own: boolean;
}

export function VoicePlayer({ id, src, durationMs, own }: Props) {
  const { t } = useTranslation('screens');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [mediaMs, setMediaMs] = useState<number | null>(null);
  const bars = useMemo(() => waveformBars(id), [id]);

  const totalMs = durationMs ?? mediaMs ?? 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => {
      const dur =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : totalMs;
      setCurrentMs(audio.currentTime * 1000);
      setProgress(dur > 0 ? Math.min(1, (audio.currentTime * 1000) / dur) : 0);
    };
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setMediaMs(audio.duration * 1000);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      setCurrentMs(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
    };
  }, [totalMs]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // Un singur vocal pe rând: oprim celelalte playere din pagină.
      document.querySelectorAll('audio').forEach((other) => {
        if (other !== audio) other.pause();
      });
      const played = audio.play?.();
      if (played && typeof played.catch === 'function') played.catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || totalMs <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = (fraction * totalMs) / 1000;
    setProgress(fraction);
  };

  const filled = Math.round(progress * bars.length);

  return (
    <div className={own ? 'voice voice--own' : 'voice'} data-testid="voice-player">
      <button
        type="button"
        className="voice__toggle"
        aria-label={playing ? t('chat.voice.pause') : t('chat.voice.play')}
        onClick={toggle}
      >
        <ChatIcon name={playing ? 'pause' : 'play'} size={20} />
      </button>
      <div className="voice__body">
        <div className="voice__wave" onClick={seek} aria-hidden="true">
          {bars.map((height, i) => (
            <span
              // Barele sunt fixe pentru un mesaj: indexul e o cheie stabilă.
              key={i}
              className={i < filled ? 'voice__bar voice__bar--played' : 'voice__bar'}
              style={{ height: `${Math.round(height * 100)}%` }}
            />
          ))}
        </div>
        <span className="voice__time">
          {formatDuration(playing || currentMs > 0 ? currentMs : totalMs)}
        </span>
      </div>
      <audio ref={audioRef} src={src || undefined} preload="metadata" />
    </div>
  );
}
