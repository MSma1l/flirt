/**
 * Foaia de previzualizare dinaintea trimiterii unei poze sau a unui video:
 * fișierul ales, o descriere opțională, „Anulează" și „Trimite".
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { hasHtml, LIMITS } from '@mobile/utils/validation';

import { ChatIcon } from './ChatIcons';
import { makeObjectUrl, revokeObjectUrl } from './chatMedia';

interface Props {
  file: File;
  kind: 'image' | 'video';
  onCancel: () => void;
  onSend: (caption: string) => void;
}

export function MediaPreviewSheet({ file, kind, onCancel, onSend }: Props) {
  const { t } = useTranslation(['screens', 'chat', 'auth']);
  const [caption, setCaption] = useState('');
  const [url, setUrl] = useState('');

  // Creat ȘI eliberat în același efect: sigur și sub StrictMode.
  useEffect(() => {
    const next = makeObjectUrl(file);
    setUrl(next);
    return () => revokeObjectUrl(next);
  }, [file]);

  const trimmed = caption.trim();
  const captionError = trimmed && hasHtml(trimmed) ? t('auth:validation.noHtml') : null;

  return createPortal(
    <div
      className="media-sheet__backdrop"
      data-testid="media-preview"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="media-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'image' ? t('screens:chat.preview.titlePhoto') : t('screens:chat.preview.titleVideo')}
      >
        <header className="media-sheet__header">
          <button
            type="button"
            className="chat-icon-button"
            aria-label={t('screens:chat.preview.cancel')}
            onClick={onCancel}
          >
            <ChatIcon name="close" />
          </button>
          <h3 className="media-sheet__title">
            {kind === 'image' ? t('screens:chat.preview.titlePhoto') : t('screens:chat.preview.titleVideo')}
          </h3>
        </header>

        <div className="media-sheet__media">
          {kind === 'image' ? (
            url ? <img src={url} alt={t('screens:chat.media.photo')} /> : null
          ) : url ? (
            <video src={url} controls playsInline preload="metadata" />
          ) : null}
        </div>

        {captionError ? <p className="error-text">{captionError}</p> : null}

        <form
          className="media-sheet__row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!captionError) onSend(trimmed);
          }}
        >
          <input
            className="media-sheet__caption"
            value={caption}
            maxLength={LIMITS.message}
            placeholder={t('screens:chat.preview.caption')}
            aria-label={t('screens:chat.preview.caption')}
            onChange={(e) => setCaption(e.target.value)}
          />
          <button
            type="submit"
            className="chat-send"
            aria-label={t('screens:chat.preview.send')}
            disabled={!!captionError}
            data-testid="media-preview-send"
          >
            <ChatIcon name="send" size={20} />
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
