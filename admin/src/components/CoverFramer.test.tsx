/**
 * Editorul de încadrare a posterului: tragere, tastatură, zoom, resetare.
 *
 * jsdom nu încarcă imagini și nu face layout: declanșăm `load` manual (cu
 * dimensiuni naturale puse pe element) și dăm ramei un `getBoundingClientRect`
 * real, ca formula de tragere să aibă cu ce lucra.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_FRAMING, type Framing } from '../lib/coverFraming';
import { eventsMessages } from '../i18n/messages/events';
import { CoverFramer } from './CoverFramer';

const TEXTS = eventsMessages.ro.form.framing;

// jsdom nu are `PointerEvent`: fără el, `fireEvent.pointerDown` creează un
// `Event` gol (fără `clientX`/`pointerId`). Un dublu minimal peste `MouseEvent`.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}

function Harness({ initial = DEFAULT_FRAMING }: { initial?: Framing }) {
  const [value, setValue] = useState<Framing>(initial);
  return (
    <>
      <CoverFramer src="https://cdn.exemplu.md/poster.jpg" value={value} onChange={setValue} texts={TEXTS} />
      <output data-testid="value">{`${value.x.toFixed(2)} ${value.y.toFixed(2)} ${value.zoom.toFixed(2)}`}</output>
    </>
  );
}

/** Imagine portret 600×900 într-o ramă 400×300. */
function loadImage(): HTMLElement {
  const img = screen.getByTestId('cover-framer-img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 600 });
  Object.defineProperty(img, 'naturalHeight', { value: 900 });
  fireEvent.load(img);
  const frame = screen.getByTestId('cover-framer-frame');
  frame.getBoundingClientRect = () =>
    ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return frame;
}

describe('CoverFramer', () => {
  it('tragerea mută punctul focal, iar imaginea primește stilul exact', () => {
    render(<Harness />);
    const frame = loadImage();

    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 200, clientY: 100, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 200, clientY: 250, pointerType: 'mouse' });
    fireEvent.pointerUp(frame, { pointerId: 1, pointerType: 'mouse' });

    // Surplus vertical 300 px ⇒ 150 px în jos = vârful imaginii (y = 0).
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.00 1.00');
    expect((screen.getByTestId('cover-framer-img') as HTMLImageElement).style.objectPosition).toBe('50% 0%');
  });

  it('slider-ul de zoom și butonul „Centrează"', () => {
    render(<Harness />);
    loadImage();

    fireEvent.change(screen.getByLabelText(/Zoom/), { target: { value: '2' } });
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.50 2.00');
    expect((screen.getByTestId('cover-framer-img') as HTMLImageElement).style.transform).toBe('scale(2)');

    fireEvent.click(screen.getByRole('button', { name: 'Centrează' }));
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.50 1.00');
  });

  it('tastatura: săgețile mută imaginea, +/− schimbă zoom-ul', () => {
    render(<Harness />);
    const frame = loadImage();

    fireEvent.keyDown(frame, { key: 'ArrowDown' });
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.48 1.00');
    fireEvent.keyDown(frame, { key: '+' });
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.48 1.10');
  });

  it('arată aceeași încadrare și în rama cardului din listă', () => {
    render(<Harness initial={{ x: 0.3, y: 0.6, zoom: 1.5 }} />);
    const images = screen
      .getByTestId('cover-framer')
      .querySelectorAll<HTMLImageElement>('img.cover-framer__img');
    expect(images).toHaveLength(2);
    for (const img of images) {
      expect(img.style.objectPosition).toBe('30% 60%');
      expect(img.style.transform).toBe('scale(1.5)');
    }
  });

  it('pinch cu două degete pe ramă schimbă zoom-ul', () => {
    render(<Harness />);
    const frame = loadImage();
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 100, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerDown(frame, { pointerId: 2, clientX: 200, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(frame, { pointerId: 2, clientX: 300, clientY: 100, pointerType: 'touch' });
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.50 2.00');
  });
});

describe('CoverFramer — selecția pe imaginea întreagă', () => {
  /** Zona de selecție: imaginea 600×900 afișată la 200×300. */
  function selectionArea(): HTMLElement {
    loadImage();
    const area = screen.getByTestId('cover-framer-select');
    area.getBoundingClientRect = () =>
      ({ width: 200, height: 300, top: 0, left: 0, right: 200, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return area;
  }

  it('apare abia după ce imaginea s-a încărcat, cu chenarele ambelor rame', () => {
    render(<Harness />);
    expect(screen.queryByTestId('cover-framer-select')).not.toBeInTheDocument();
    selectionArea();
    // Portret 2:3 în rama 4:3: se vede toată lățimea și jumătate din înălțime, centrat.
    const hero = screen.getByTestId('cover-framer-sel-hero');
    expect(hero.style.width).toBe('100%');
    expect(hero.style.height).toBe('50%');
    expect(hero.style.top).toBe('25%');
    expect(hero).toHaveClass('is-active');
    expect(screen.getByTestId('cover-framer-sel-card').style.height).toBe('33.33%');
  });

  it('tragerea chenarului mută zona vizibilă', () => {
    render(<Harness />);
    const area = selectionArea();
    const hero = screen.getByTestId('cover-framer-sel-hero');
    fireEvent.pointerDown(hero, { pointerId: 1, clientX: 100, clientY: 150, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 100, clientY: 225, pointerType: 'mouse' });
    fireEvent.pointerUp(area, { pointerId: 1, pointerType: 'mouse' });
    // 75 px din 300 = 0.25 din imagine = toată rezerva în jos ⇒ partea de JOS (y = 1).
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 1.00 1.00');
    expect(screen.getByTestId('cover-framer-sel-hero').style.top).toBe('50%');
  });

  it('colțul chenarului face zoom, cu colțul opus fix', () => {
    render(<Harness />);
    const area = selectionArea();
    fireEvent.pointerDown(screen.getByTestId('cover-framer-handle-se'), {
      pointerId: 1,
      clientX: 200,
      clientY: 225,
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 100, clientY: 150, pointerType: 'mouse' });
    fireEvent.pointerUp(area, { pointerId: 1, pointerType: 'mouse' });
    // Chenar pe jumătate ⇒ zoom 2; colțul NW rămâne în (0, 0.25).
    expect(screen.getByTestId('value')).toHaveTextContent('0.00 0.33 2.00');
    const hero = screen.getByTestId('cover-framer-sel-hero');
    expect(hero.style.left).toBe('0%');
    expect(hero.style.top).toBe('25%');
    expect(hero.style.width).toBe('50%');
  });

  it('chenarul cardului: comutare, apoi clic în afara lui îl centrează acolo', () => {
    render(<Harness />);
    const area = selectionArea();
    fireEvent.click(screen.getByRole('button', { name: 'Cardul din listă' }));
    expect(screen.getByTestId('cover-framer-sel-card')).toHaveClass('is-active');
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 100, clientY: 30, button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(area, { pointerId: 1, pointerType: 'mouse' });
    // Sus de tot (chenarul nu poate ieși din imagine) ⇒ y = 0.
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.00 1.00');
  });

  it('Ctrl + rotiță face zoom; rotița simplă (fără focus) lasă pagina să se deruleze', () => {
    render(<Harness />);
    const area = selectionArea();
    fireEvent.wheel(area, { deltaY: 100 });
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.50 1.00');
    fireEvent.wheel(area, { deltaY: -100, ctrlKey: true });
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.50 1.22');
  });

  it('butoanele − / + schimbă zoom-ul', () => {
    render(<Harness />);
    selectionArea();
    fireEvent.click(screen.getByRole('button', { name: 'Mărește' }));
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.50 1.10');
    fireEvent.click(screen.getByRole('button', { name: 'Micșorează' }));
    expect(screen.getByTestId('value')).toHaveTextContent('0.50 0.50 1.00');
  });
});
