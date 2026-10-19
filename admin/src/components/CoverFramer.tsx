/**
 * Editorul de încadrare a posterului: adminul TRAGE imaginea ca să aleagă ce se
 * vede (punctul focal) și o mărește cu un slider (zoom 1..3).
 *
 * Feedback-ul care l-a cerut: „când alegi poza pentru poster se pune cum vrea
 * ea — vreau să o pun eu cum vreau". Până acum aplicația tăia afișul mereu pe
 * centru, cu proporția cardului.
 *
 * Ce vede adminul e EXACT ce vede utilizatorul: aceleași proporții de ramă și
 * aceeași formulă CSS ca în miniapp (`lib/coverFraming.ts`). Rama mare e
 * posterul de pe pagina evenimentului (4:3), cea mică — coperta cardului din
 * listă (2:1); ambele folosesc același punct focal.
 *
 * Fără biblioteci: pointer events (mouse, deget, creion) cu `setPointerCapture`,
 * plus tastatură (săgeți = mută, +/− = zoom) pentru accesibilitate.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import {
  clamp,
  COVER_RATIO,
  COVER_ZOOM_MAX,
  COVER_ZOOM_MIN,
  coverImageStyle,
  DEFAULT_FRAMING,
  isDefaultFraming,
  panFocus,
  type Framing,
} from '../lib/coverFraming';
import { Button } from './ui';

export interface CoverFramerTexts {
  legend: string;
  hint: string;
  frameLabel: string;
  zoom: string;
  reset: string;
  heroCaption: string;
  cardCaption: string;
  loading: string;
  broken: string;
}

/** Pasul tastaturii: 2% din imagine (cu Shift — 10%). */
const KEY_STEP = 0.02;
const KEY_STEP_BIG = 0.1;
const ZOOM_STEP = 0.1;

type LoadState = 'loading' | 'ok' | 'broken';

export function CoverFramer({
  src,
  value,
  onChange,
  texts,
}: {
  /** Adresa (deja rezolvată pentru afișare) a imaginii de copertă. */
  src: string;
  value: Framing;
  onChange: (next: Framing) => void;
  texts: CoverFramerTexts;
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  // Valoarea curentă, citită în handlerele de mișcare: între două evenimente
  // `pointermove` React poate să nu fi re-randat încă, iar o valoare veche ar
  // face imaginea să „sară" înapoi.
  const latest = useRef(value);
  latest.current = value;
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setLoad('loading');
    setNatural(null);
  }, [src]);

  const emit = (next: Framing): void => {
    latest.current = next;
    onChange(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (load !== 'ok' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    const frame = frameRef.current;
    if (!start || start.id !== event.pointerId || !frame || !natural) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    drag.current = { ...start, x: event.clientX, y: event.clientY };
    const rect = frame.getBoundingClientRect();
    emit(panFocus(latest.current, { dx, dy }, { width: rect.width, height: rect.height }, natural));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const current = latest.current;
    let next: Framing | null = null;
    // Săgețile mută IMAGINEA (ca tragerea): dreapta = imaginea spre dreapta,
    // deci punctul focal spre stânga.
    if (event.key === 'ArrowLeft') next = { ...current, x: clamp(current.x + step, 0, 1) };
    if (event.key === 'ArrowRight') next = { ...current, x: clamp(current.x - step, 0, 1) };
    if (event.key === 'ArrowUp') next = { ...current, y: clamp(current.y + step, 0, 1) };
    if (event.key === 'ArrowDown') next = { ...current, y: clamp(current.y - step, 0, 1) };
    if (event.key === '+' || event.key === '=') {
      next = { ...current, zoom: clamp(current.zoom + ZOOM_STEP, COVER_ZOOM_MIN, COVER_ZOOM_MAX) };
    }
    if (event.key === '-') {
      next = { ...current, zoom: clamp(current.zoom - ZOOM_STEP, COVER_ZOOM_MIN, COVER_ZOOM_MAX) };
    }
    if (next) {
      event.preventDefault();
      emit(next);
    }
  };

  const imageStyle = coverImageStyle(value);
  const zoomPercent = Math.round(value.zoom * 100);

  return (
    <div className="cover-framer" data-testid="cover-framer">
      <span className="field__label">{texts.legend}</span>
      <p className="field__hint">{texts.hint}</p>

      <div className="cover-framer__frames">
        <figure className="cover-framer__figure cover-framer__figure--hero">
          <div
            ref={frameRef}
            className={`cover-framer__frame${dragging ? ' cover-framer__frame--dragging' : ''}`}
            style={{ aspectRatio: String(COVER_RATIO.hero) }}
            role="group"
            tabIndex={0}
            aria-label={texts.frameLabel}
            data-testid="cover-framer-frame"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          >
            <img
              className="cover-framer__img"
              src={src}
              alt=""
              draggable={false}
              style={imageStyle}
              data-testid="cover-framer-img"
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
                setLoad('ok');
              }}
              onError={() => setLoad('broken')}
            />
            {/* Regula treimilor: ajută la așezarea subiectului, doar vizual. */}
            <span className="cover-framer__grid" aria-hidden="true" />
            {load !== 'ok' ? (
              <span className="cover-framer__state">
                {load === 'loading' ? texts.loading : texts.broken}
              </span>
            ) : null}
          </div>
          <figcaption className="cover-framer__caption">{texts.heroCaption}</figcaption>
        </figure>

        <figure className="cover-framer__figure cover-framer__figure--card">
          <div className="cover-framer__frame cover-framer__frame--static" style={{ aspectRatio: String(COVER_RATIO.card) }}>
            <img className="cover-framer__img" src={src} alt="" draggable={false} style={imageStyle} />
          </div>
          <figcaption className="cover-framer__caption">{texts.cardCaption}</figcaption>
        </figure>
      </div>

      <div className="cover-framer__controls">
        <label className="cover-framer__zoom" htmlFor="event-cover-zoom">
          <span>{texts.zoom}</span>
          <input
            id="event-cover-zoom"
            type="range"
            min={COVER_ZOOM_MIN}
            max={COVER_ZOOM_MAX}
            step={0.01}
            value={value.zoom}
            disabled={load !== 'ok'}
            onChange={(e) =>
              emit({
                ...latest.current,
                zoom: clamp(Number(e.target.value), COVER_ZOOM_MIN, COVER_ZOOM_MAX),
              })
            }
          />
          <output className="mono" htmlFor="event-cover-zoom">{`${zoomPercent}%`}</output>
        </label>
        <Button small disabled={isDefaultFraming(value)} onClick={() => emit(DEFAULT_FRAMING)}>
          {texts.reset}
        </Button>
      </div>
    </div>
  );
}
