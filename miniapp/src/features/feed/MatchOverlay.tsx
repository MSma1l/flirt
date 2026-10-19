/**
 * „Aveți match!" — momentul cel mai important al produsului, deci un ecran
 * întreg, nu o fereastră de sistem: ambele poze față în față, o inimă între
 * ele și două drumuri clare — „Scrie un mesaj" (deschide conversația creată
 * odată cu match-ul) sau „Continuă să cauți".
 *
 * Poza proprie vine din profilul meu (aceeași cheie de cache ca ecranul de
 * profil, deci de obicei e deja acolo). Fără poză — inițiala, nu un gol.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/icons';
import { fetchMyProfile } from '@/features/profile/profileApi';
import { haptic } from '@/telegram/bridge';

import './match.css';

export interface MatchOverlayProps {
  name: string;
  photo?: string | null;
  /** „Scrie un mesaj": părintele deschide conversația creată la match. */
  onWrite: () => void;
  onContinue: () => void;
}

function Portrait({ src, name, side }: { src?: string | null; name: string; side: 'me' | 'them' }) {
  return (
    <span className={`match-overlay__portrait match-overlay__portrait--${side}`}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <span className="match-overlay__initial">{name.trim().charAt(0).toUpperCase() || '?'}</span>
      )}
    </span>
  );
}

export function MatchOverlay({ name, photo, onWrite, onContinue }: MatchOverlayProps) {
  const { t } = useTranslation('miniapp');
  const titleId = useId();
  const writeRef = useRef<HTMLButtonElement | null>(null);

  const me = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const myPhoto = me.data?.photos?.[0] ?? null;
  const myName = me.data?.name ?? t('feed.match.you');

  // Focus pe acțiunea principală + vibrație scurtă la apariție; Esc = continuă.
  useEffect(() => {
    writeRef.current?.focus();
    haptic('medium');
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onContinue();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onContinue]);

  // PORTAL în `body`: un strămoș cu `transform`/`filter` (cardul, cadrul) ar
  // transforma `position: fixed` în „fix față de el" și l-ar tăia sau l-ar
  // lăsa sub bara de taburi. Din `body`, ecranul acoperă garantat tot.
  return createPortal(
    <div
      className="match-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="match-overlay"
    >
      <div className="match-overlay__glow" aria-hidden="true" />
      <div className="match-overlay__content">
        <p className="match-overlay__eyebrow">{t('feed.match.label')}</p>
        <h2 id={titleId} className="match-overlay__title">
          {t('feed.match.title')}
        </h2>
        <div className="match-overlay__pair" aria-hidden="true">
          <Portrait src={myPhoto} name={myName} side="me" />
          <span className="match-overlay__heart">
            <Icon name="heart" active />
          </span>
          <Portrait src={photo} name={name} side="them" />
        </div>
        <p className="match-overlay__body">{t('feed.match.body', { name })}</p>
        <div className="match-overlay__actions">
          <button
            ref={writeRef}
            type="button"
            className="button match-overlay__write"
            data-testid="match-write"
            onClick={onWrite}
          >
            {t('feed.match.write')}
          </button>
          <button
            type="button"
            className="button button--ghost match-overlay__continue"
            data-testid="match-continue"
            onClick={onContinue}
          >
            {t('feed.match.keepSwiping')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default MatchOverlay;
