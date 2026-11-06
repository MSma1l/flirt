/**
 * Gesturile unei bule de mesaj, ca în Telegram:
 *   - APĂSARE LUNGĂ (~450 ms, degetul nemișcat) → meniul mesajului;
 *   - GLISARE SPRE STÂNGA → răspuns: bula urmează degetul (max ~70 px), săgeata
 *     de răspuns apare treptat în dreapta; eliberată după ~55 px, setează
 *     mesajul ca țintă a răspunsului;
 *   - CLIC-DREAPTA (desktop) → același meniu.
 *
 * Toate pe POINTER EVENTS, deci merg la fel cu degetul și cu mouse-ul.
 *
 * DE CE NU STRICĂ DERULAREA: zona bulei are `touch-action: pan-y` (în CSS), deci
 * browserul păstrează derularea verticală nativă și ne trimite `pointercancel`
 * când o preia. Glisarea se angajează DOAR dacă mișcarea orizontală spre stânga
 * domină clar; altfel gestul e abandonat și lăsat browserului.
 *
 * DE CE NU STRICĂ ATINGERILE MEDIA: după o apăsare lungă sau o glisare, clicul
 * sintetic de la ridicarea degetului e înghițit în faza de captură — poza nu se
 * deschide, playerul nu pornește. O atingere scurtă trece neatinsă.
 *
 * PERFORMANȚĂ: deplasarea se scrie DIRECT în stilul elementului (prin ref), nu
 * prin `setState` — bula memoizată nu se re-randează la fiecare `pointermove`.
 */
import { useEffect, useRef } from 'react';

import { haptic } from '@/telegram/bridge';

/** Cât trebuie ținut degetul pe bulă pentru meniu. */
export const LONG_PRESS_MS = 450;
/** Mișcarea tolerată în timpul apăsării lungi, în px. */
export const MOVE_TOLERANCE_PX = 10;
/** Deplasarea maximă a bulei la glisare. */
export const SWIPE_MAX_PX = 70;
/** Pragul de la care eliberarea înseamnă „răspunde". */
export const SWIPE_TRIGGER_PX = 55;

type Mode = 'idle' | 'pending' | 'swipe' | 'done';

interface Options {
  /** Fără gesturi: bule optimiste, mesaje șterse. */
  enabled: boolean;
  /** Apăsare lungă sau clic-dreapta. */
  onLongPress: () => void;
  /** Glisare spre stânga peste prag. Fără el, glisarea e dezactivată. */
  onSwipe?: (() => void) | undefined;
}

interface GestureState {
  mode: Mode;
  pointerId: number;
  startX: number;
  startY: number;
  offset: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Înghite clicul care urmează unui gest consumat. */
  suppressClick: boolean;
}

export function useMessageGestures({ enabled, onLongPress, onSwipe }: Options) {
  /** Elementul care se deplasează (bula). */
  const trackRef = useRef<HTMLDivElement>(null);
  /** Săgeata de răspuns, dezvăluită sub bulă. */
  const arrowRef = useRef<HTMLSpanElement>(null);

  const state = useRef<GestureState>({
    mode: 'idle',
    pointerId: -1,
    startX: 0,
    startY: 0,
    offset: 0,
    timer: null,
    suppressClick: false,
  });

  // Ultimele callback-uri, fără să recreăm logica la fiecare randare.
  const longPressRef = useRef(onLongPress);
  const swipeRef = useRef(onSwipe);
  longPressRef.current = onLongPress;
  swipeRef.current = onSwipe;

  const clearTimer = () => {
    const s = state.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  };

  useEffect(() => () => clearTimer(), []);

  const paint = (offset: number, dragging: boolean) => {
    const track = trackRef.current;
    const arrow = arrowRef.current;
    if (track) {
      track.style.transition = dragging ? 'none' : '';
      track.style.transform = offset ? `translateX(${offset}px)` : '';
    }
    if (arrow) {
      const progress = Math.min(1, Math.abs(offset) / SWIPE_TRIGGER_PX);
      arrow.style.opacity = offset ? String(progress) : '';
      arrow.style.transform = offset ? `translateY(-50%) scale(${0.6 + 0.4 * progress})` : '';
    }
  };

  const reset = () => {
    const s = state.current;
    clearTimer();
    if (s.mode === 'swipe') paint(0, false);
    s.mode = 'idle';
    s.offset = 0;
    s.pointerId = -1;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const s = state.current;
    s.suppressClick = false;
    // Un gest nou începe curat (inclusiv după un clic-dreapta anterior).
    if (s.mode === 'done') s.mode = 'idle';
    if (!enabled) return;
    // Clic-dreapta / mijloc: meniul vine din `contextmenu`, nu din apăsarea lungă.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    clearTimer();
    s.mode = 'pending';
    s.pointerId = event.pointerId;
    s.startX = event.clientX;
    s.startY = event.clientY;
    s.offset = 0;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (s.mode !== 'pending') return;
      s.mode = 'done';
      s.suppressClick = true;
      haptic('medium');
      longPressRef.current();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const s = state.current;
    if (event.pointerId !== s.pointerId) return;
    const dx = event.clientX - s.startX;
    const dy = event.clientY - s.startY;

    if (s.mode === 'pending') {
      if (Math.hypot(dx, dy) <= MOVE_TOLERANCE_PX) return;
      // Degetul s-a mișcat: nu mai e apăsare lungă.
      clearTimer();
      const horizontalLeft = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
      if (horizontalLeft && swipeRef.current) {
        s.mode = 'swipe';
        s.suppressClick = true;
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          /* pointerul a dispărut deja */
        }
      } else {
        // Derulare verticală sau glisare spre dreapta: gestul nu e al nostru.
        s.mode = 'idle';
        return;
      }
    }

    if (s.mode === 'swipe') {
      // Peste maxim, bula abia se mai mișcă (rezistență elastică).
      const pull = Math.max(0, -dx);
      const eased = pull <= SWIPE_MAX_PX ? pull : SWIPE_MAX_PX + (pull - SWIPE_MAX_PX) * 0.15;
      s.offset = -Math.min(eased, SWIPE_MAX_PX + 12);
      paint(s.offset, true);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const s = state.current;
    if (event.pointerId !== s.pointerId) return;
    const fire = s.mode === 'swipe' && -s.offset >= SWIPE_TRIGGER_PX;
    reset();
    if (fire) {
      haptic('medium');
      swipeRef.current?.();
    }
  };

  const onPointerCancel = () => {
    // Browserul a preluat gestul (derulare) — revenim fără acțiune.
    reset();
  };

  const onContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    // Fără meniul nativ al WebView-ului / browserului, inclusiv pe mesajele șterse.
    event.preventDefault();
    if (!enabled) return;
    const s = state.current;
    // Pe Android, `contextmenu` vine și după apăsarea lungă deja tratată.
    if (s.mode === 'done') return;
    reset();
    s.mode = 'done';
    s.suppressClick = true;
    longPressRef.current();
  };

  const onClickCapture = (event: React.MouseEvent<HTMLElement>) => {
    const s = state.current;
    if (!s.suppressClick) return;
    s.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    trackRef,
    arrowRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onContextMenu,
      onClickCapture,
    },
  };
}
