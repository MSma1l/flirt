/**
 * Composerul conversației, în stilul mesageriilor moderne:
 *   [emoji] [ câmp-pastilă care crește până la ~5 rânduri ] [agrafă] [trimite | mic]
 *
 * - butonul rotund de TRIMITERE apare când există text; altfel, dacă dispozitivul
 *   poate înregistra, apare MICROFONUL (ca în Telegram). Fără `MediaRecorder`
 *   (WebView-ul Telegram pe iOS, de pildă) microfonul lipsește și rămâne
 *   butonul de trimitere, inactiv cât timp câmpul e gol;
 * - emoji-urile se inserează LA CURSOR, nu la final;
 * - agrafa deschide selectorul nativ de fișiere (poză / video; pe telefon,
 *   sistemul oferă și camera);
 * - butonul de înregistrare are DOUĂ moduri, ca în Telegram: microfon (vocal)
 *   și cameră (mesaj video rotund, „кружок"). O ATINGERE scurtă comută modul
 *   (cu un indiciu „ține apăsat…"); ȚINUT APĂSAT ~0,3 s pornește înregistrarea
 *   în modul curent. Din tastatură (Enter / Space) butonul înregistrează direct.
 *   Odată pornită, înregistrarea rămâne „blocată": panoul cu anulare / trimitere
 *   e același ca înainte, deci ridicarea degetului nu trimite nimic.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LIMITS } from '@mobile/utils/validation';

import { ChatIcon } from './ChatIcons';
import { formatDuration, MEDIA_LIMITS } from './chatMedia';
import { EmojiPicker } from './EmojiPicker';
import { useVideoNoteRecorder, type VideoNoteRecording } from './useVideoNoteRecorder';
import { isVoiceRecordingSupported, useVoiceRecorder, type VoiceRecording } from './useVoiceRecorder';

/** ~5 rânduri de 22px + padding. */
const MAX_INPUT_HEIGHT = 132;

/** Cât trebuie ținut apăsat butonul ca să pornească înregistrarea. */
export const HOLD_TO_RECORD_MS = 300;
/** Cât stă vizibil indiciul de după comutarea modului. */
const HINT_MS = 2500;
/**
 * După ce degetul se ridică de pe un buton ținut apăsat, clicul sintetic poate
 * ateriza pe butonul de trimitere apărut în locul microfonului — îl ignorăm.
 */
const SEND_GUARD_MS = 400;

export type RecordMode = 'voice' | 'video';

const noopVideoNote = () => {};

/** Previzualizarea rotundă a camerei, cu inelul de progres spre limita de 60 s. */
function VideoNotePreview({ stream, elapsedMs }: { stream: MediaStream | null; elapsedMs: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    try {
      el.srcObject = stream;
      const playing = el.play?.();
      if (playing && typeof playing.catch === 'function') playing.catch(() => {});
    } catch {
      /* jsdom / WebView fără `srcObject` */
    }
  }, [stream]);

  const r = 48;
  const c = 2 * Math.PI * r;
  const progress = Math.min(1, elapsedMs / MEDIA_LIMITS.videoNoteMs);
  return (
    <div className="video-note-rec" data-testid="video-note-preview">
      <div className="video-note-rec__circle">
        <video ref={videoRef} className="video-note-rec__video" muted playsInline autoPlay />
        <svg className="video-note-rec__ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={r} className="video-note-rec__track" />
          <circle
            cx="50"
            cy="50"
            r={r}
            className="video-note-rec__value"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
          />
        </svg>
      </div>
    </div>
  );
}

interface Props {
  draft: string;
  onDraftChange: (value: string) => void;
  canSend: boolean;
  onSubmit: () => void;
  /** Eroare afișată deasupra rândului (deja tradusă). */
  errorText?: string | null;
  errorTestId?: string;
  onPickFile: (file: File) => void;
  onVoice: (recording: VoiceRecording) => void;
  /** Mesajul video rotund. Fără el, butonul rămâne doar microfon. */
  onVideoNote?: (recording: VideoNoteRecording) => void;
}

export function ChatComposer({
  draft,
  onDraftChange,
  canSend,
  onSubmit,
  errorText,
  errorTestId,
  onPickFile,
  onVoice,
  onVideoNote,
}: Props) {
  const { t } = useTranslation(['chat', 'screens']);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [voiceSupported] = useState(isVoiceRecordingSupported);
  const voiceRecorder = useVoiceRecorder(onVoice);
  const videoRecorder = useVideoNoteRecorder(onVideoNote ?? noopVideoNote);
  const videoEnabled = !!onVideoNote;
  const [mode, setMode] = useState<RecordMode>('voice');
  const [hint, setHint] = useState<RecordMode | null>(null);

  const hasText = draft.trim().length > 0;
  const videoActive = videoRecorder.status !== 'idle';
  // Înregistrarea în curs (vocal SAU video) — panoul comun anulare / trimitere.
  const recorder = videoActive ? videoRecorder : voiceRecorder;
  const recording = voiceRecorder.status !== 'idle' || videoActive;

  /* ——— Gestul butonului: atingere = comută modul, ținut apăsat = înregistrează ——— */

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerDownRef = useRef(0);
  const sendGuardUntilRef = useRef(0);

  useEffect(
    () => () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    },
    [],
  );

  const startRecording = useCallback(
    (which: RecordMode) => {
      setEmojiOpen(false);
      setHint(null);
      voiceRecorder.clearError();
      videoRecorder.clearError();
      if (which === 'video' && videoEnabled) void videoRecorder.start();
      else void voiceRecorder.start();
    },
    [voiceRecorder, videoRecorder, videoEnabled],
  );

  const toggleMode = () => {
    if (!videoEnabled) return;
    const next: RecordMode = mode === 'voice' ? 'video' : 'voice';
    setMode(next);
    setHint(next);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(null), HINT_MS);
  };

  const clearHold = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const onRecordPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    lastPointerDownRef.current = Date.now();
    clearHold();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      // Degetul încă e pe ecran: clicul de la ridicare nu are voie să trimită.
      sendGuardUntilRef.current = Number.POSITIVE_INFINITY;
      const release = () => {
        sendGuardUntilRef.current = Date.now() + SEND_GUARD_MS;
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      startRecording(mode);
    }, HOLD_TO_RECORD_MS);
  };

  const onRecordPointerUp = () => {
    // Ridicat ÎNAINTE de prag → atingere scurtă → comutăm modul.
    if (holdTimerRef.current) {
      clearHold();
      toggleMode();
    }
  };

  const onRecordClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Clicul care urmează unui gest cu degetul / mouse-ul a fost deja tratat.
    if (event.detail > 0 || Date.now() - lastPointerDownRef.current < 1000) return;
    // Tastatură (Enter / Space) sau clic programatic: înregistrăm direct.
    startRecording(mode);
  };

  // Câmpul crește odată cu textul, până la ~5 rânduri; apoi derulează.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight || 0, MAX_INPUT_HEIGHT);
    if (next > 0) el.style.height = `${next}px`;
    el.style.overflowY = (el.scrollHeight || 0) > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';

    if (caretRef.current !== null) {
      const caret = caretRef.current;
      caretRef.current = null;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* câmp ascuns */
      }
    }
  }, [draft]);

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = (draft.slice(0, start) + emoji + draft.slice(end)).slice(0, LIMITS.message);
    caretRef.current = Math.min(start + emoji.length, next.length);
    onDraftChange(next);
  };

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    onSubmit();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Pe desktop (pointer fin), Enter trimite și Shift+Enter rupe rândul.
    // Pe telefon, Enter rămâne rând nou — ca în orice mesagerie mobilă.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    const finePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    if (!finePointer) return;
    event.preventDefault();
    submit();
  };

  const sendRecording = async () => {
    if (Date.now() < sendGuardUntilRef.current) return;
    if (videoActive) {
      const rec = await videoRecorder.stop();
      if (rec) onVideoNote?.(rec);
      return;
    }
    const rec = await voiceRecorder.stop();
    if (rec) onVoice(rec);
  };

  const recorderError =
    voiceRecorder.error === 'denied'
      ? t('screens:chat.voice.denied')
      : voiceRecorder.error === 'unavailable'
        ? t('screens:chat.voice.unavailable')
        : videoRecorder.error === 'denied'
          ? t('screens:chat.videoNote.denied')
          : videoRecorder.error === 'unavailable'
            ? t('screens:chat.videoNote.unavailable')
            : null;

  const shownError = errorText ?? recorderError;

  return (
    <form className="chat-composer" onSubmit={submit}>
      {shownError ? (
        <p
          className="chat-composer__error"
          role="alert"
          data-testid={errorText ? errorTestId : 'voice-error'}
        >
          {shownError}
        </p>
      ) : null}

      {emojiOpen && !recording ? <EmojiPicker onPick={insertEmoji} /> : null}

      {hint && !recording && !shownError ? (
        <p className="chat-composer__hint" role="status" data-testid="record-hint">
          {hint === 'video'
            ? t('screens:chat.videoNote.hintVideo')
            : t('screens:chat.videoNote.hintVoice')}
        </p>
      ) : null}

      {videoActive ? (
        <VideoNotePreview stream={videoRecorder.stream} elapsedMs={videoRecorder.elapsedMs} />
      ) : null}

      {recording ? (
        <div
          className="chat-composer__row chat-recorder"
          data-testid={videoActive ? 'video-note-recorder' : 'voice-recorder'}
        >
          <button
            type="button"
            className="chat-icon-button chat-recorder__cancel"
            aria-label={
              videoActive ? t('screens:chat.videoNote.cancel') : t('screens:chat.voice.cancel')
            }
            onClick={recorder.cancel}
          >
            <ChatIcon name="close" />
          </button>
          <span className="chat-recorder__status" aria-live="polite">
            <span className="chat-recorder__dot" aria-hidden="true" />
            <span className="chat-recorder__time">{formatDuration(recorder.elapsedMs)}</span>
            <span className="chat-recorder__label">
              {videoActive
                ? t('screens:chat.videoNote.recording')
                : t('screens:chat.voice.recording')}
            </span>
          </span>
          <button
            type="button"
            className="chat-send"
            aria-label={videoActive ? t('screens:chat.videoNote.send') : t('screens:chat.voice.send')}
            data-testid={videoActive ? 'video-note-send' : 'voice-send'}
            disabled={recorder.status !== 'recording'}
            onClick={() => void sendRecording()}
          >
            <ChatIcon name="send" size={20} />
          </button>
        </div>
      ) : (
        <div className="chat-composer__row">
          <div className="chat-composer__pill">
            <button
              type="button"
              className="chat-icon-button"
              data-testid="emoji-toggle"
              aria-label={emojiOpen ? t('screens:chat.emoji.close') : t('screens:chat.emoji.open')}
              aria-pressed={emojiOpen}
              onClick={() => setEmojiOpen((open) => !open)}
            >
              <ChatIcon name={emojiOpen ? 'keyboard' : 'smile'} />
            </button>
            <textarea
              ref={inputRef}
              className="chat-composer__input"
              value={draft}
              rows={1}
              maxLength={LIMITS.message}
              placeholder={t('chat:conversation.placeholder')}
              aria-label={t('chat:conversation.placeholder')}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              className="chat-icon-button"
              data-testid="attach-button"
              aria-label={t('screens:chat.attach')}
              onClick={() => fileRef.current?.click()}
            >
              <ChatIcon name="paperclip" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="chat-composer__file"
              data-testid="attach-input"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Golim valoarea: aceeași poză aleasă de două ori declanșează din nou `change`.
                e.target.value = '';
                if (file) onPickFile(file);
              }}
            />
          </div>

          {voiceSupported && !hasText ? (
            <button
              type="button"
              className={
                videoEnabled ? 'chat-send chat-send--mic chat-send--hold' : 'chat-send chat-send--mic'
              }
              data-testid="mic-button"
              data-mode={mode}
              aria-label={
                mode === 'video' ? t('screens:chat.videoNote.record') : t('screens:chat.voice.record')
              }
              disabled={recording}
              {...(videoEnabled
                ? {
                    onPointerDown: onRecordPointerDown,
                    onPointerUp: onRecordPointerUp,
                    onPointerLeave: clearHold,
                    onPointerCancel: clearHold,
                    // Apăsarea lungă nu deschide meniul contextual al WebView-ului.
                    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
                    onClick: onRecordClick,
                  }
                : {
                    // Fără mesaje video: comportamentul de dinainte (atingere = vocal).
                    onClick: () => startRecording('voice'),
                  })}
            >
              <ChatIcon name={mode === 'video' ? 'video' : 'mic'} size={22} />
            </button>
          ) : (
            <button
              type="submit"
              className="chat-send"
              data-testid="send-button"
              aria-label={t('chat:conversation.send')}
              disabled={!canSend}
            >
              <ChatIcon name="send" size={20} />
            </button>
          )}
        </div>
      )}
    </form>
  );
}
