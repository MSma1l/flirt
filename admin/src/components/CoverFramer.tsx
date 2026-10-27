/**
 * Editorul de încadrare a posterului: adminul ALEGE zona din imagine care se
 * vede în aplicație — pe cardul din listă (2:1) și pe pagina evenimentului (4:3).
 *
 * Feedback-ul care l-a cerut: „când alegi poza pentru poster se pune cum vrea
 * ea — vreau să o pun eu cum vreau", apoi „vreau să selectez zona care se vede
 * în postare, ca în previzualizarea evenimentului".
 *
 * Două moduri de lucru, legate de ACEEAȘI valoare (punct focal + zoom):
 *   1. SELECȚIA pe imaginea întreagă: dreptunghiul ramei active (pagina sau
 *      cardul) se trage ca să-l muți, se mărește/micșorează din colțuri (=
 *      zoom), un clic în afara lui îl centrează acolo. Ce e în afara lui e
 *      întunecat — exact partea care NU se vede. Cealaltă ramă apare punctat.
 *   2. PREVIZUALIZĂRILE live (4:3 și 2:1), identice cu miniapp-ul: imaginea
 *      se trage în ramă, ca într-un telefon.
 * Zoom: slider, butoane −/+, pinch (touch și trackpad), Ctrl/⌘ + rotiță (sau
 * rotița simplă după un clic pe zonă), tastele +/−. Săgețile mută selecția.
 *
 * Ce vede adminul e EXACT ce vede utilizatorul: aceleași proporții de ramă și
 * aceeași formulă CSS ca în miniapp (`lib/coverFraming.ts`, verificat de
 * `coverFraming.parity.test.ts`).
 *
 * Fără biblioteci: pointer events (mouse, deget, creion) cu `setPointerCapture`.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  type RefObject,
} from 'react';

import {
  centerSelectionAt,
  clamp,
  COVER_RATIO,
  COVER_ZOOM_MAX,
  COVER_ZOOM_MIN,
  coverImageStyle,
  DEFAULT_FRAMING,
  isDefaultFraming,
  moveSelection,
  panFocus,
  resizeSelection,
  visibleRect,
  zoomBy,
  type Corner,
  type Framing,
} from '../lib/coverFraming';
import { Button } from './ui';

export interface CoverFramerTexts {
  legend: string;
  hint: string;
  frameLabel: string;
  cardFrameLabel: string;
  selectLabel: string;
  selectFor: string;
  previewsTitle: string;
  zoom: string;
  zoomIn: string;
  zoomOut: string;
  reset: string;
  heroCaption: string;
  cardCaption: string;
  loading: string;
  broken: string;
}

type FrameKind = keyof typeof COVER_RATIO;
type LoadState = 'loading' | 'ok' | 'broken';
type Size = { width: number; height: number };
type Emit = (next: Framing) => void;

const FRAME_KINDS: FrameKind[] = ['hero', 'card'];
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

/** Pasul tastaturii: 2% din imagine (cu Shift — 10%). */
const KEY_STEP = 0.02;
const KEY_STEP_BIG = 0.1;
const ZOOM_STEP = 0.1;
/** Cât mărește o „treaptă" de rotiță (~100 px de `deltaY`): ×1.22. */
const WHEEL_SENSITIVITY = 0.002;

/** Mutarea/zoom-ul din tastatură; `selection` = săgețile mută SELECȚIA, altfel imaginea. */
function keyFraming(event: KeyboardEvent, current: Framing, selection: boolean): Framing | null {
  const step = (event.shiftKey ? KEY_STEP_BIG : KEY_STEP) * (selection ? 1 : -1);
  if (event.key === 'ArrowLeft') return { ...current, x: clamp(current.x - step, 0, 1) };
  if (event.key === 'ArrowRight') return { ...current, x: clamp(current.x + step, 0, 1) };
  if (event.key === 'ArrowUp') return { ...current, y: clamp(current.y - step, 0, 1) };
  if (event.key === 'ArrowDown') return { ...current, y: clamp(current.y + step, 0, 1) };
  if (event.key === '+' || event.key === '=') {
    return { ...current, zoom: clamp(current.zoom + ZOOM_STEP, COVER_ZOOM_MIN, COVER_ZOOM_MAX) };
  }
  if (event.key === '-') {
    return { ...current, zoom: clamp(current.zoom - ZOOM_STEP, COVER_ZOOM_MIN, COVER_ZOOM_MAX) };
  }
  return null;
}

/**
 * Zoom din rotiță pe un element. Listener NATIV cu `passive: false`: React
 * atașează `wheel` ca pasiv, deci `preventDefault` (oprirea derulării paginii)
 * n-ar avea efect. Rotița simplă derulează în continuare formularul; zoom-ul
 * vine cu Ctrl/⌘ (și pinch-ul de trackpad, pe care browserul îl trimite ca
 * Ctrl + rotiță) sau după ce adminul a dat clic pe zonă (are focus).
 */
function useWheelZoom(
  ref: RefObject<HTMLElement>,
  latest: MutableRefObject<Framing>,
  emit: MutableRefObject<Emit>,
  enabled: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey || document.activeElement === el)) return;
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      emit.current(zoomBy(latest.current, Math.exp(-delta * WHEEL_SENSITIVITY)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, latest, emit, enabled]);
}

/**
 * Pinch cu două degete: zoom-ul de la începutul gestului × raportul distanțelor.
 * Cât timp sunt ≥2 degete pe ecran, tragerea cu un deget e suspendată.
 */
function usePinch(latest: MutableRefObject<Framing>, emit: MutableRefObject<Emit>) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ distance: number; framing: Framing } | null>(null);

  const distance = (): number => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  return {
    /** `true` = gestul e (sau a devenit) pinch: apelantul nu începe tragerea. */
    down(event: PointerEvent): boolean {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) {
        start.current = { distance: distance(), framing: latest.current };
      }
      return pointers.current.size >= 2;
    },
    /** `true` = mișcarea a fost consumată de pinch. */
    move(event: PointerEvent): boolean {
      if (!pointers.current.has(event.pointerId)) return false;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const begin = start.current;
      if (!begin || pointers.current.size < 2) return false;
      const now = distance();
      if (begin.distance > 0 && now > 0) {
        emit.current({ ...latest.current, zoom: zoomBy(begin.framing, now / begin.distance).zoom });
      }
      return true;
    },
    up(event: PointerEvent): void {
      pointers.current.delete(event.pointerId);
      if (pointers.current.size < 2) start.current = null;
    },
  };
}

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
  // Valoarea curentă, citită în handlerele de mișcare: între două evenimente
  // `pointermove` React poate să nu fi re-randat încă, iar o valoare veche ar
  // face imaginea să „sară" înapoi.
  const latest = useRef(value);
  latest.current = value;
  const emitRef = useRef<Emit>(() => undefined);
  emitRef.current = (next: Framing): void => {
    latest.current = next;
    onChange(next);
  };
  const emit = (next: Framing): void => emitRef.current(next);

  const [natural, setNatural] = useState<Size | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const [active, setActive] = useState<FrameKind>('hero');

  useEffect(() => {
    setLoad('loading');
    setNatural(null);
  }, [src]);

  const onImageLoad = (img: HTMLImageElement): void => {
    setNatural({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    setLoad('ok');
  };
  const ready = load === 'ok' && natural !== null;
  const zoomPercent = Math.round(value.zoom * 100);
  const captions: Record<FrameKind, string> = { hero: texts.heroCaption, card: texts.cardCaption };

  return (
    <div className="cover-framer" data-testid="cover-framer">
      <span className="field__label">{texts.legend}</span>
      <p className="field__hint">{texts.hint}</p>

      {ready ? (
        <>
          <div className="cover-framer__switch" role="group" aria-label={texts.selectFor}>
            <span className="cover-framer__switch-label">{texts.selectFor}</span>
            {FRAME_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`cover-framer__switch-btn${active === kind ? ' is-active' : ''}`}
                aria-pressed={active === kind}
                onClick={() => setActive(kind)}
              >
                {captions[kind]}
              </button>
            ))}
          </div>
          <SelectionArea
            src={src}
            natural={natural}
            value={value}
            active={active}
            captions={captions}
            label={texts.selectLabel}
            latest={latest}
            emit={emitRef}
            onActivate={setActive}
          />
        </>
      ) : null}

      <span className="cover-framer__subtitle">{texts.previewsTitle}</span>
      <div className="cover-framer__frames">
        {FRAME_KINDS.map((kind) => (
          <FramePreview
            key={kind}
            kind={kind}
            src={src}
            value={value}
            natural={natural}
            load={load}
            texts={texts}
            caption={captions[kind]}
            latest={latest}
            emit={emitRef}
            onLoad={onImageLoad}
            onError={() => setLoad('broken')}
          />
        ))}
      </div>

      <div className="cover-framer__controls">
        <div className="cover-framer__zoom">
          <label htmlFor="event-cover-zoom">{texts.zoom}</label>
          <button
            type="button"
            className="cover-framer__step"
            aria-label={texts.zoomOut}
            disabled={!ready || value.zoom <= COVER_ZOOM_MIN}
            onClick={() => emit(zoomBy(latest.current, 1 / 1.1))}
          >
            −
          </button>
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
          <button
            type="button"
            className="cover-framer__step"
            aria-label={texts.zoomIn}
            disabled={!ready || value.zoom >= COVER_ZOOM_MAX}
            onClick={() => emit(zoomBy(latest.current, 1.1))}
          >
            +
          </button>
          <output className="mono" htmlFor="event-cover-zoom">{`${zoomPercent}%`}</output>
        </div>
        <Button small disabled={isDefaultFraming(value)} onClick={() => emit(DEFAULT_FRAMING)}>
          {texts.reset}
        </Button>
      </div>
    </div>
  );
}

/**
 * Imaginea ÎNTREAGĂ, cu dreptunghiurile celor două rame peste ea. Ramă activă:
 * contur plin, mânere în colțuri, restul imaginii întunecat; cealaltă: punctat.
 */
function SelectionArea({
  src,
  natural,
  value,
  active,
  captions,
  label,
  latest,
  emit,
  onActivate,
}: {
  src: string;
  natural: Size;
  value: Framing;
  active: FrameKind;
  captions: Record<FrameKind, string>;
  label: string;
  latest: MutableRefObject<Framing>;
  emit: MutableRefObject<Emit>;
  onActivate: (kind: FrameKind) => void;
}): JSX.Element {
  const areaRef = useRef<HTMLDivElement>(null);
  const imageRatio = natural.width / natural.height;
  const gesture = useRef<{
    id: number;
    kind: FrameKind;
    corner: Corner | null;
    startX: number;
    startY: number;
    start: Framing;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pinch = usePinch(latest, emit);
  useWheelZoom(areaRef, latest, emit, true);

  /** Poziția cursorului în fracții din imagine (null fără layout, ex. jsdom). */
  const pointOf = (event: PointerEvent): { u: number; v: number; w: number; h: number } | null => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      u: (event.clientX - rect.left) / rect.width,
      v: (event.clientY - rect.top) / rect.height,
      w: rect.width,
      h: rect.height,
    };
  };

  /** `kind`/`corner` vin din elementul apăsat (dreptunghi, mâner) prin `data-*`. */
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    areaRef.current?.focus({ preventScroll: true });
    areaRef.current?.setPointerCapture?.(event.pointerId);
    if (pinch.down(event)) {
      gesture.current = null;
      setDragging(false);
      return;
    }
    const target = event.target as HTMLElement;
    const kind = (target.closest('[data-frame]')?.getAttribute('data-frame') as FrameKind | null) ?? active;
    const corner = (target.getAttribute('data-corner') as Corner | null) ?? null;
    let start = latest.current;
    // Clic în afara dreptunghiului: îl centrăm acolo și continuăm cu mutarea.
    if (!target.closest('[data-frame]')) {
      const point = pointOf(event);
      if (point) {
        start = centerSelectionAt(start, point, COVER_RATIO[kind], imageRatio);
        emit.current(start);
      }
    }
    if (kind !== active) onActivate(kind);
    gesture.current = { id: event.pointerId, kind, corner, startX: event.clientX, startY: event.clientY, start };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (pinch.move(event)) return;
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const point = pointOf(event);
    if (!point) return;
    const ratio = COVER_RATIO[g.kind];
    if (g.corner) {
      emit.current(resizeSelection(g.start, g.corner, point, ratio, imageRatio));
      return;
    }
    const delta = { du: (event.clientX - g.startX) / point.w, dv: (event.clientY - g.startY) / point.h };
    emit.current(moveSelection(g.start, delta, ratio, imageRatio));
  };

  const endGesture = (event: PointerEvent<HTMLDivElement>): void => {
    pinch.up(event);
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyFraming(event, latest.current, true);
    if (next) {
      event.preventDefault();
      emit.current(next);
    }
  };

  const pct = (n: number): string => `${Math.round(n * 10000) / 100}%`;
  // Ramă activă desenată ULTIMA, ca să fie deasupra (mânerele ei rămân apucabile).
  const order = FRAME_KINDS.filter((k) => k !== active).concat(active);

  return (
    <div
      ref={areaRef}
      className={`cover-framer__select${dragging ? ' cover-framer__select--dragging' : ''}`}
      role="group"
      tabIndex={0}
      aria-label={label}
      data-testid="cover-framer-select"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onKeyDown={onKeyDown}
    >
      <img className="cover-framer__select-img" src={src} alt="" draggable={false} />
      {order.map((kind) => {
        const r = visibleRect(value, COVER_RATIO[kind], imageRatio);
        const isActive = kind === active;
        return (
          <div
            key={kind}
            data-frame={kind}
            data-testid={`cover-framer-sel-${kind}`}
            className={`cover-framer__sel cover-framer__sel--${kind}${isActive ? ' is-active' : ''}`}
            style={{ left: pct(r.left), top: pct(r.top), width: pct(r.width), height: pct(r.height) }}
          >
            <span className="cover-framer__sel-label">{captions[kind]}</span>
            {isActive
              ? CORNERS.map((corner) => (
                  <span
                    key={corner}
                    data-corner={corner}
                    data-testid={`cover-framer-handle-${corner}`}
                    className={`cover-framer__handle cover-framer__handle--${corner}`}
                    aria-hidden="true"
                  />
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}

/** O ramă de previzualizare (4:3 sau 2:1), ca în miniapp; imaginea se trage în ea. */
function FramePreview({
  kind,
  src,
  value,
  natural,
  load,
  texts,
  caption,
  latest,
  emit,
  onLoad,
  onError,
}: {
  kind: FrameKind;
  src: string;
  value: Framing;
  natural: Size | null;
  load: LoadState;
  texts: CoverFramerTexts;
  caption: string;
  latest: MutableRefObject<Framing>;
  emit: MutableRefObject<Emit>;
  onLoad: (img: HTMLImageElement) => void;
  onError: () => void;
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pinch = usePinch(latest, emit);
  useWheelZoom(frameRef, latest, emit, load === 'ok');
  // Testele (și `EventsPage`) găsesc rama posterului după id-urile vechi.
  const suffix = kind === 'hero' ? '' : `-${kind}`;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (load !== 'ok' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    frameRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pinch.down(event)) {
      drag.current = null;
      setDragging(false);
      return;
    }
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (pinch.move(event)) return;
    const start = drag.current;
    const frame = frameRef.current;
    if (!start || start.id !== event.pointerId || !frame || !natural) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    drag.current = { ...start, x: event.clientX, y: event.clientY };
    const rect = frame.getBoundingClientRect();
    emit.current(panFocus(latest.current, { dx, dy }, { width: rect.width, height: rect.height }, natural));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    pinch.up(event);
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Săgețile mută IMAGINEA (ca tragerea): dreapta = imaginea spre dreapta,
    // deci punctul focal spre stânga.
    const next = keyFraming(event, latest.current, false);
    if (next) {
      event.preventDefault();
      emit.current(next);
    }
  };

  return (
    <figure className={`cover-framer__figure cover-framer__figure--${kind}`}>
      <div
        ref={frameRef}
        className={`cover-framer__frame${dragging ? ' cover-framer__frame--dragging' : ''}`}
        style={{ aspectRatio: String(COVER_RATIO[kind]) }}
        role="group"
        tabIndex={0}
        aria-label={kind === 'hero' ? texts.frameLabel : texts.cardFrameLabel}
        data-testid={`cover-framer-frame${suffix}`}
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
          style={coverImageStyle(value)}
          data-testid={`cover-framer-img${suffix}`}
          onLoad={(e) => onLoad(e.currentTarget)}
          onError={onError}
        />
        {/* Regula treimilor: ajută la așezarea subiectului, doar vizual. */}
        <span className="cover-framer__grid" aria-hidden="true" />
        {load !== 'ok' ? (
          <span className="cover-framer__state">{load === 'loading' ? texts.loading : texts.broken}</span>
        ) : null}
      </div>
      <figcaption className="cover-framer__caption">{caption}</figcaption>
    </figure>
  );
}
