/**
 * Vizualizatorul pe tot ecranul pentru o poză sau un video din conversație.
 * Overlay temporar (position: fixed), închis cu butonul, cu tasta Escape sau
 * cu clic pe fundal.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ChatIcon } from './ChatIcons';

interface Props {
  kind: 'image' | 'video';
  src: string;
  onClose: () => void;
}

export function MediaViewer({ kind, src, onClose }: Props) {
  const { t } = useTranslation('screens');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="media-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={kind === 'image' ? t('chat.media.photo') : t('chat.media.video')}
      data-testid="media-viewer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="media-viewer__close"
        aria-label={t('chat.viewer.close')}
        onClick={onClose}
      >
        <ChatIcon name="close" size={24} />
      </button>
      {kind === 'image' ? (
        <img className="media-viewer__content" src={src} alt={t('chat.media.photo')} />
      ) : (
        <video className="media-viewer__content" src={src} controls autoPlay playsInline />
      )}
    </div>,
    document.body,
  );
}
