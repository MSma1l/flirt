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
 *   sistemul oferă și camera).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LIMITS } from '@mobile/utils/validation';

import { ChatIcon } from './ChatIcons';
import { formatDuration } from './chatMedia';
import { EmojiPicker } from './EmojiPicker';
import { isVoiceRecordingSupported, useVoiceRecorder, type VoiceRecording } from './useVoiceRecorder';

/** ~5 rânduri de 22px + padding. */
const MAX_INPUT_HEIGHT = 132;

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
}: Props) {
  const { t } = useTranslation(['chat', 'screens']);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [voiceSupported] = useState(isVoiceRecordingSupported);
  const recorder = useVoiceRecorder(onVoice);

  const hasText = draft.trim().length > 0;
  const recording = recorder.status !== 'idle';

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

  const sendVoice = async () => {
    const rec = await recorder.stop();
    if (rec) onVoice(rec);
  };

  const recorderError =
    recorder.error === 'denied'
      ? t('screens:chat.voice.denied')
      : recorder.error === 'unavailable'
        ? t('screens:chat.voice.unavailable')
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

      {recording ? (
        <div className="chat-composer__row chat-recorder" data-testid="voice-recorder">
          <button
            type="button"
            className="chat-icon-button chat-recorder__cancel"
            aria-label={t('screens:chat.voice.cancel')}
            onClick={recorder.cancel}
          >
            <ChatIcon name="close" />
          </button>
          <span className="chat-recorder__status" aria-live="polite">
            <span className="chat-recorder__dot" aria-hidden="true" />
            <span className="chat-recorder__time">{formatDuration(recorder.elapsedMs)}</span>
            <span className="chat-recorder__label">{t('screens:chat.voice.recording')}</span>
          </span>
          <button
            type="button"
            className="chat-send"
            aria-label={t('screens:chat.voice.send')}
            data-testid="voice-send"
            disabled={recorder.status !== 'recording'}
            onClick={() => void sendVoice()}
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
              className="chat-send chat-send--mic"
              data-testid="mic-button"
              aria-label={t('screens:chat.voice.record')}
              disabled={recorder.status !== 'idle'}
              onClick={() => {
                setEmojiOpen(false);
                void recorder.start();
              }}
            >
              <ChatIcon name="mic" size={22} />
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
