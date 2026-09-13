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
 *
 * În capul ecranului stă bara de povești (`StoriesStrip`), ca pe nativ
 * (`mobile/app/(tabs)/ankete.tsx`). Ea derulează pe orizontală, iar cardul
 * ascultă gesturi pe ambele axe — două lucruri care se fură unul pe altul dacă
 * le lași. Izolarea e scrisă la ambele capete: bara își marchează zona și
 * oprește propagarea (`StoriesBar.tsx`), iar cardul ignoră orice gest pornit
 * într-o zonă străină (`onPointerDown`, mai jos).
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

import { StatusScreen, type StatusAction } from '@/components/StatusScreen';
import { StoriesStrip } from '@/features/stories/StoriesStrip';
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

  /** Lista pentru care `index` a fost calculat ultima dată. */
  const placedForRef = useRef<FeedCard[] | undefined>(undefined);
  /** Userul a cerut explicit un deck nou („Caută mai multe") → de la primul card. */
  const restartRef = useRef(false);

  /**
   * A venit o listă nouă: ne ținem de CARDUL pe care stătea userul, nu de
   * poziție. Regula e cea din aplicația nativă (`mobile/app/(tabs)/ankete.tsx`),
   * și contează mai mult de când poveștile se deschid din capul feedului:
   * `data` e o referință NOUĂ la fiecare refetch de fundal (fereastra revine în
   * față după ce userul a privit o poveste), chiar dacă vin exact aceleași
   * carduri. Un `setIndex(0)` legat de referință îl arunca pe user înapoi la
   * primul card în mijlocul răsfoirii.
   */
  useEffect(() => {
    if (!data || placedForRef.current === data) return;
    const previous = placedForRef.current;
    placedForRef.current = data;

    const anchor = restartRef.current ? null : (previous?.[index]?.userId ?? null);
    const next = restartRef.current
      ? 0
      : anchor === null
        ? Math.min(index, data.length)
        : Math.max(
            0,
            data.findIndex((card) => card.userId === anchor),
          );
    restartRef.current = false;

    if (next === index) return;
    setIndex(next);
    setOffset(ORIGIN);
  }, [data, index]);

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
      } else {
        // REFUZ, nu eșec: `POST /feed/undo` răspunde 200 cu `undone: false`
        // (`backend/app/services/feed_service.py::undo_last_swipe`) când nu
        // găsește niciun `Like` al userului — singurul caz în care refuză.
        // Se întâmplă real: swipe-urile numărate aici sunt DOAR cele din
        // sesiunea curentă, iar ultimul like poate să nu mai existe pe server
        // (anulat de pe alt dispozitiv, sau șters odată cu contul celui plăcut).
        // Fără ramura asta, utilizatorul apăsa „Anulează", cardul nu revenea și
        // pe ecran nu apărea NIMIC.
        setActionError(t('feed.undoNothing'));
        // Serverul e sursa de adevăr: dacă el nu are ce anula, nici noi nu mai
        // arătăm butonul de undo.
        setSwipeCount(0);
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
    // Gestul a pornit în altă zonă (bara de povești)? Atunci nu e al cardului.
    // Garda e explicită, nu bazată pe faptul — azi adevărat — că bara nu e un
    // descendent al cardului: dacă mâine cineva mută bara peste card, cardul tot
    // nu-i fură derularea, iar testul de izolare rămâne valabil.
    const zone = (event.target as Element | null)?.closest?.('[data-gesture-zone]') ?? null;
    if (zone !== null && zone !== event.currentTarget) return;
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
      <StatusScreen
        loading
        testId="status-feed-loading"
        title={t('feed.loading')}
        body={t('feed.loadingBody')}
      />
    );
  }

  if (isError) {
    return (
      <StatusScreen
        testId="status-feed-error"
        title={t('errors.network.title')}
        body={t('feed.error')}
        actions={[
          {
            label: t('actions.retry', { ns: 'common' }),
            onClick: () => void refetch(),
            testId: 'deck-retry',
          },
        ]}
      />
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
    const actions: StatusAction[] = [
      {
        label: t('feed.reload'),
        testId: 'deck-reload',
        onClick: () => {
          // Cerere explicită de deck nou: reperul de mai sus n-are ce căuta
          // aici, altfel ne-ar duce înapoi la cardul de dinainte.
          restartRef.current = true;
          setIndex(0);
          void refetch();
        },
      },
    ];
    if (swipeCount > 0) {
      actions.push({
        label: t('feed.undo'),
        testId: 'deck-undo',
        ghost: true,
        disabled: busy,
        onClick: () => void onUndo(),
      });
    }

    return (
      <>
        {/* Poveștile rămân la locul lor și când nu mai sunt ankete: ele sunt
            conținut proaspăt, exact ce mai are de făcut userul aici. La fel pe
            nativ, în ramura de deck gol din `app/(tabs)/ankete.tsx`. */}
        <StoriesStrip />
        <StatusScreen
          testId="status-feed-empty"
          title={t('feed.empty')}
          body={t('feed.emptyBody')}
          actions={actions}
        >
          {errorText}
          {matchModal}
        </StatusScreen>
      </>
    );
  }

  const rotation = Math.max(-8, Math.min(8, (offset.x / 300) * 8));

  return (
    <>
      <StoriesStrip />

      <div className="deck">
        <div
          className={settling ? 'deck__card deck__card--settling' : 'deck__card'}
          data-testid="deck-card"
          data-gesture-zone="deck"
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
