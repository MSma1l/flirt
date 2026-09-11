/**
 * Deck-ul de ankete pentru Mini App — ecranul principal al produsului.
 *
 * REUTILIZAT din aplicația Expo, fără copiere:
 *   - `feedApi.ts`      — cererile /feed, /feed/swipe, /feed/undo (prin alias-ul
 *                         `@/services/api`, care aici duce la clientul web);
 *   - `swipeDirection.ts` — pragurile și regula de dominanță a axelor;
 *   - `types.ts`, `compat.ts` — tipurile și pragurile de compatibilitate.
 *
 * REscris: interfața. Gesturile folosesc EVENIMENTE DE POINTER (aceleași
 * handlere pentru deget, stylus și mouse), nu `PanResponder`. Efectul de
 * înclinare pe accelerometru (`useTiltSwipe`) NU e portat: e cosmetic și oricum
 * inactiv pe web.
 *
 * Direcțiile sunt identice cu cele din aplicația nativă:
 *   stânga = dislike · dreapta = like · sus = super like · jos = undo
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchFeed, swipe, undoSwipe } from '@mobile/features/feed/feedApi';
import {
  resolveDirection,
  SWIPE_THRESHOLD_X,
  SWIPE_THRESHOLD_Y,
  type SwipeDirection,
} from '@mobile/features/feed/swipeDirection';
import type { FeedCard, SwipeAction } from '@mobile/features/feed/types';

import { haptic } from '@/telegram/bridge';

import { ProfileCardView } from './ProfileCardView';

/** Cât se mișcă degetul până acceptăm că e un gest, nu o atingere. */
const GESTURE_SLOP = 8;

/** Cât de departe „aruncăm" cardul în afara ecranului la o acțiune confirmată. */
const FLING = 1000;

interface Offset {
  x: number;
  y: number;
}

const ORIGIN: Offset = { x: 0, y: 0 };

/** Opacitatea unui indiciu: 0 la start, 1 când s-a atins pragul direcției. */
function cueOpacity(distance: number, threshold: number): number {
  return Math.max(0, Math.min(1, distance / threshold));
}

export function SwipeDeck() {
  const { t } = useTranslation('miniapp');
  const { data, isLoading, isError, refetch } = useQuery<FeedCard[]>({
    queryKey: ['feed'],
    queryFn: fetchFeed,
  });

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState<Offset>(ORIGIN);
  const [settling, setSettling] = useState(false);
  const [swipeCount, setSwipeCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [matchName, setMatchName] = useState<string | null>(null);

  // Punctul de plecare al gestului curent. `null` = niciun deget pe card.
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const cards = data ?? [];
  const current = cards[index];

  // Feed nou → pornim iar de la primul card (la fel ca pe nativ).
  useEffect(() => {
    setIndex(0);
    setOffset(ORIGIN);
  }, [data]);

  const resetCard = useCallback(() => {
    setSettling(true);
    setOffset(ORIGIN);
  }, []);

  const performSwipe = useCallback(async (card: FeedCard, action: SwipeAction) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await swipe(card.userId, action);
      if (result.matched) setMatchName(card.name);
      setSwipeCount((c) => c + 1);
      setIndex((i) => i + 1);
    } catch {
      // Rețea sau server picat: NU avansăm indexul — rămânem pe același card,
      // ca utilizatorul să poată reîncerca exact aceeași alegere.
      setActionError(t('feed.sendFailed'));
    } finally {
      setSettling(false);
      setOffset(ORIGIN);
      setBusy(false);
    }
  }, [t]);

  const onUndo = useCallback(async () => {
    if (busy || swipeCount === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await undoSwipe();
      if (result.undone) {
        setSwipeCount((c) => Math.max(0, c - 1));
        setIndex((i) => Math.max(0, i - 1));
        setOffset(ORIGIN);
      }
    } catch {
      setActionError(t('feed.undoFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, swipeCount, t]);

  /**
   * Punctul UNIC în care o direcție devine acțiune — degetul și butoanele de
   * accesibilitate ajung amândouă aici, ca „stânga" să însemne același lucru.
   */
  const runDirection = useCallback(
    (direction: SwipeDirection) => {
      if (direction === 'down') {
        resetCard();
        void onUndo();
        return;
      }
      if (!current || busy) {
        resetCard();
        return;
      }

      haptic('light');

      // Confirmare vizuală: cardul pleacă în direcția gestului, apoi se trimite
      // cererea. `setSettling` pornește tranziția CSS.
      setSettling(true);
      if (direction === 'right') setOffset({ x: FLING, y: 0 });
      else if (direction === 'left') setOffset({ x: -FLING, y: 0 });
      else setOffset({ x: 0, y: -FLING });

      const action: SwipeAction =
        direction === 'right' ? 'like' : direction === 'left' ? 'dislike' : 'super_like';
      void performSwipe(current, action);
    },
    [busy, current, onUndo, performSwipe, resetCard],
  );

  // ——— Gesturi cu evenimente de pointer ———

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busy) return;
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    setSettling(false);
    // Capturarea pointerului ține gestul legat de card chiar dacă degetul iese
    // din el — fără asta, un swipe rapid „scapă" și cardul rămâne agățat.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < GESTURE_SLOP && Math.abs(dy) < GESTURE_SLOP) return;
    setOffset({ x: dx, y: dy });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const direction = resolveDirection(dx, dy);
    // Gest scurt sau diagonal (indecis) → cardul revine. Nu ghicim intenția.
    if (!direction) {
      resetCard();
      return;
    }
    runDirection(direction);
  };

  const onPointerCancel = () => {
    dragStart.current = null;
    resetCard();
  };

  // ——— Randare ———

  if (isLoading) {
    return (
      <div className="screen-center">
        <div className="spinner" role="status" aria-label={t('feed.loading')} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="screen-center">
        <p className="body-text">{t('feed.error')}</p>
        <button type="button" className="button" onClick={() => void refetch()}>
          {t('actions.retry', { ns: 'common' })}
        </button>
      </div>
    );
  }

  const matchModal =
    matchName !== null ? (
      <div className="match-modal" role="dialog" aria-modal="true">
        <div className="match-modal__box">
          <h2 className="title">{t('feed.match.title')}</h2>
          <p className="body-text">{t('feed.match.body', { name: matchName })}</p>
          <button type="button" className="button" onClick={() => setMatchName(null)}>
            {t('feed.match.continue')}
          </button>
        </div>
      </div>
    ) : null;

  const errorText = actionError ? (
    <p className="error-text" data-testid="deck-action-error">
      {actionError}
    </p>
  ) : null;

  if (!current) {
    // Feed gol NU e o eroare, și ecranul trebuie să spună asta răspicat. E chiar
    // starea din producție pentru un cont nou într-un oraș mic: nu mai sunt
    // profiluri de arătat acum. Un ecran gol, fără titlu și fără explicație, a
    // fost citit de utilizatori drept „aplicația nu merge".
    return (
      <div className="screen-center">
        <div className="status-icon" aria-hidden="true">
          ♡
        </div>
        <h1 className="title">{t('feed.empty')}</h1>
        <p className="body-text">{t('feed.emptyBody')}</p>
        <button
          type="button"
          className="button"
          data-testid="deck-reload"
          onClick={() => {
            setIndex(0);
            void refetch();
          }}
        >
          {t('feed.reload')}
        </button>
        {swipeCount > 0 ? (
          <button
            type="button"
            className="button button--ghost"
            data-testid="deck-undo"
            disabled={busy}
            onClick={() => void onUndo()}
          >
            {t('feed.undo')}
          </button>
        ) : null}
        {errorText}
        {matchModal}
      </div>
    );
  }

  const rotation = Math.max(-8, Math.min(8, (offset.x / 300) * 8));

  return (
    <>
      <div className="deck">
        <div
          className={settling ? 'deck__card deck__card--settling' : 'deck__card'}
          data-testid="deck-card"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={onPointerCancel}
        >
          <ProfileCardView card={current} />

          <span
            className="cue cue--like"
            style={{ opacity: cueOpacity(offset.x, SWIPE_THRESHOLD_X) }}
          >
            {t('feed.cue.like')}
          </span>
          <span
            className="cue cue--nope"
            style={{ opacity: cueOpacity(-offset.x, SWIPE_THRESHOLD_X) }}
          >
            {t('feed.cue.nope')}
          </span>
          <span
            className="cue cue--super"
            style={{ opacity: cueOpacity(-offset.y, SWIPE_THRESHOLD_Y) }}
          >
            {t('feed.cue.super')}
          </span>
          <span
            className="cue cue--undo"
            style={{ opacity: cueOpacity(offset.y, SWIPE_THRESHOLD_Y) }}
          >
            {t('feed.cue.undo')}
          </span>
        </div>
      </div>

      <div className="deck__hint">
        <p className="caption">{t('feed.hint')}</p>
        {errorText}
      </div>

      {matchModal}
    </>
  );
}
