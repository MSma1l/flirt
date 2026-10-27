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

/**
 * Starea redării, pe lângă play/pauză:
 *   - `loading`: s-a cerut redarea, browserul încă descarcă (rețea lentă);
 *   - `error`: fișierul nu poate fi redat (format nesuportat de WebView, rețea,
 *     server) — arătăm un mesaj clar + reîncercare, nu un buton care „nu face
 *     nimic" (exact simptomul raportat: vocalul apărea, dar nu se auzea).
 */
type PlaybackState = 'idle' | 'loading' | 'error';

/** De ce a eșuat redarea: formatul (dispozitivul nu-l poate decoda) sau rețeaua. */
export type FailureKind = 'format' | 'network';

/**
 * Cât așteptăm după `play()` până declarăm redarea blocată. WebView-ul iOS poate
 * rămâne „în așteptare" la nesfârșit (fără evenimentul `error`) pe un fișier pe
 * care nu-l poate decoda sau pe o conexiune căzută — fără plafon, spinnerul se
 * învârtea la nesfârșit și vocalul „nu se auzea".
 */
export const VOICE_STALL_MS = 20_000;

/**
 * `MediaError.code` 2 = rețea (reîncercarea poate ajuta); 3 (decodare), 4
 * (format nesuportat) sau necunoscut → fișierul nu poate fi redat aici.
 */
export function failureKind(error: { code?: number } | null | undefined): FailureKind {
  return error?.code === 2 ? 'network' : 'format';
}

interface AudioSessionLike {
  type?: string;
}

/**
 * iOS (Safari/WKWebView 16.4+): sesiunea audio a paginii pe „playback", ca
 * vocalul să se audă și cu telefonul pe SILENȚIOS (comutatorul lateral). Cu
 * sesiunea implicită, WebView-ul din Telegram poate reda mut — progresul
 * înaintează, dar nu se aude nimic. În afara iOS API-ul lipsește → nu face nimic.
 */
export function preparePlaybackSession(nav: Navigator | undefined = globalThis.navigator): void {
  const session = (nav as (Navigator & { audioSession?: AudioSessionLike }) | undefined)
    ?.audioSession;
  if (!session) return;
  try {
    if (session.type !== 'playback') session.type = 'playback';
  } catch {
    /* API parțial / blocat: redarea continuă oricum */
  }
}

export function VoicePlayer({ id, src, durationMs, own }: Props) {
  const { t } = useTranslation('screens');
  const audioRef = useRef<HTMLAudioElement>(null);
  const stallRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [state, setState] = useState<PlaybackState>('idle');
  const [failure, setFailure] = useState<FailureKind>('format');
  const [progress, setProgress] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [mediaMs, setMediaMs] = useState<number | null>(null);
  const bars = useMemo(() => waveformBars(id), [id]);

  const clearStall = () => {
    if (stallRef.current) clearTimeout(stallRef.current);
    stallRef.current = null;
  };

  // Demontare: niciun temporizator rămas în urmă.
  useEffect(() => clearStall, []);

  // Fișier nou (ex. bula optimistă înlocuită de mesajul de pe server): de la zero.
  useEffect(() => {
    clearStall();
    setState('idle');
    setPlaying(false);
    setProgress(0);
    setCurrentMs(0);
  }, [src]);

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
    const onPlaying = () => {
      clearStall();
      setState('idle');
    };
    const onWaiting = () => {
      if (!audio.paused) setState('loading');
    };
    const onError = () => {
      clearStall();
      setPlaying(false);
      setFailure(failureKind(audio.error));
      setState('error');
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('error', onError);
    };
  }, [totalMs]);

  const fail = (kind: FailureKind) => {
    clearStall();
    setPlaying(false);
    setFailure(kind);
    setState('error');
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) {
      // Un singur vocal pe rând: oprim celelalte playere din pagină.
      document.querySelectorAll('audio').forEach((other) => {
        if (other !== audio) other.pause();
      });
      preparePlaybackSession();
      if (state === 'error' || audio.error) {
        // Reîncercare: `load()` resetează elementul — altfel iOS rămâne pe
        // eroarea veche, iar o problemă de rețea trecătoare ar bloca mesajul.
        audio.load?.();
      }
      setState('loading');
      clearStall();
      // `play()` SINCRON în handlerul de click (fără `await` înainte): iOS
      // pornește redarea doar direct dintr-un gest al utilizatorului.
      const played = audio.play?.();
      stallRef.current = setTimeout(() => {
        stallRef.current = null;
        // Nimic redat după plafon: oprim încercarea și arătăm eroarea.
        if (audio.paused || audio.currentTime === 0) {
          audio.pause?.();
          fail('network');
        }
      }, VOICE_STALL_MS);
      if (played && typeof played.then === 'function') {
        played.then(
          () => {
            clearStall();
            setState('idle');
          },
          (error: unknown) => {
            // `AbortError` = redarea a fost întreruptă de o pauză (alt vocal
            // pornit); nu e o eroare a fișierului.
            const name = (error as { name?: string } | null)?.name;
            if (name === 'AbortError') {
              clearStall();
              setPlaying(false);
              setState('idle');
              return;
            }
            fail(name === 'NotSupportedError' ? 'format' : failureKind(audio.error));
          },
        );
      } else {
        clearStall();
        setState('idle');
      }
    } else {
      clearStall();
      audio.pause();
      setState('idle');
    }
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || state === 'error') return;
    const lengthMs =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : totalMs;
    if (lengthMs <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = (fraction * lengthMs) / 1000;
    setProgress(fraction);
    setCurrentMs(fraction * lengthMs);
  };

  const filled = Math.round(progress * bars.length);
  const failed = state === 'error';
  const loading = state === 'loading';

  let label = playing ? t('chat.voice.pause') : t('chat.voice.play');
  if (failed) label = t('chat.voice.retry');
  else if (loading) label = t('chat.voice.loading');

  return (
    <div
      className={['voice', own ? 'voice--own' : '', failed ? 'voice--error' : ''].filter(Boolean).join(' ')}
      data-testid="voice-player"
      data-state={state}
      data-failure={failed ? failure : undefined}
    >
      <button
        type="button"
        className={loading ? 'voice__toggle voice__toggle--loading' : 'voice__toggle'}
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={!src}
        onClick={toggle}
      >
        <ChatIcon name={failed ? 'retry' : playing ? 'pause' : 'play'} size={20} />
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
        {failed ? (
          <span className="voice__error" role="alert" data-testid="voice-play-error">
            {failure === 'network' ? t('chat.voice.networkError') : t('chat.voice.error')}
          </span>
        ) : (
          <span className="voice__time" data-testid="voice-time">
            {playing || currentMs > 0
              ? `${formatDuration(currentMs)}${totalMs > 0 ? ` / ${formatDuration(totalMs)}` : ''}`
              : formatDuration(totalMs)}
          </span>
        )}
      </div>
      <audio ref={audioRef} src={src || undefined} preload="metadata" />
    </div>
  );
}
