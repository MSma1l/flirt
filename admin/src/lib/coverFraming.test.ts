import { describe, expect, it } from 'vitest';

import {
  centerSelectionAt,
  COVER_RATIO,
  coverBase,
  coverImageStyle,
  DEFAULT_FRAMING,
  moveSelection,
  normalizeFraming,
  panFocus,
  resizeSelection,
  visibleRect,
  zoomBy,
  type Framing,
} from './coverFraming';

describe('coverImageStyle (oglinda miniapp-ului)', () => {
  it('implicit: centru, fără zoom', () => {
    expect(coverImageStyle(DEFAULT_FRAMING)).toEqual({
      objectFit: 'cover',
      objectPosition: '50% 50%',
      transformOrigin: '50% 50%',
      transform: undefined,
    });
  });

  it('punctul focal și zoom-ul în același punct', () => {
    const style = coverImageStyle({ x: 0.1, y: 0.9, zoom: 2.5 });
    expect(style.objectPosition).toBe('10% 90%');
    expect(style.transformOrigin).toBe('10% 90%');
    expect(style.transform).toBe('scale(2.5)');
  });
});

describe('normalizeFraming', () => {
  it('aduce valorile în interval și înlocuiește lipsurile', () => {
    expect(normalizeFraming({ x: 2, y: -1, zoom: 10 })).toEqual({ x: 1, y: 0, zoom: 3 });
    expect(normalizeFraming({})).toEqual(DEFAULT_FRAMING);
  });
});

describe('panFocus', () => {
  // Rama 400×300 (4:3), imagine portret 600×900: acoperirea e pe lățime
  // (s = 400/600), imaginea randată are 400×600 ⇒ surplus doar pe verticală.
  const frame = { width: 400, height: 300 };
  const portrait = { width: 600, height: 900 };

  it('tragerea în jos arată partea de SUS a imaginii (focus y scade)', () => {
    const next = panFocus(DEFAULT_FRAMING, { dx: 0, dy: 150 }, frame, portrait);
    // surplus vertical = 600 − 300 = 300 ⇒ 150 px = jumătate din drum.
    expect(next.y).toBeCloseTo(0);
    expect(next.x).toBe(0.5);
  });

  it('fără surplus pe orizontală, x nu se mișcă la zoom 1', () => {
    expect(panFocus(DEFAULT_FRAMING, { dx: 80, dy: 0 }, frame, portrait).x).toBe(0.5);
  });

  it('cu zoom apare surplus și pe orizontală', () => {
    const zoomed = { ...DEFAULT_FRAMING, zoom: 2 };
    // lățime randată 400·2 = 800 ⇒ surplus 400; −100 px ⇒ +0.25.
    expect(panFocus(zoomed, { dx: -100, dy: 0 }, frame, portrait).x).toBeCloseTo(0.75);
  });

  it('rămâne în [0, 1] oricât de mult ai trage', () => {
    const next = panFocus(DEFAULT_FRAMING, { dx: 0, dy: -5000 }, frame, portrait);
    expect(next.y).toBe(1);
  });

  it('dimensiuni necunoscute: nicio schimbare', () => {
    expect(panFocus(DEFAULT_FRAMING, { dx: 10, dy: 10 }, { width: 0, height: 0 }, portrait)).toBe(
      DEFAULT_FRAMING,
    );
  });
});

/**
 * Simularea la pixel a CSS-ului din miniapp: `object-fit: cover` +
 * `object-position: x% y%` + `transform: scale(z)` cu originea în același
 * punct. Întoarce partea din imagine (fracții) care ajunge în ramă.
 */
function cssVisible(f: Framing, frame: { w: number; h: number }, natural: { w: number; h: number }) {
  const s = Math.max(frame.w / natural.w, frame.h / natural.h);
  const iw = natural.w * s;
  const ih = natural.h * s;
  // `object-position`: procentul aliniază punctul x% al imaginii cu x% al ramei.
  const ox = (frame.w - iw) * f.x;
  const oy = (frame.h - ih) * f.y;
  // `scale(z)` în jurul originii o: punctul de ramă q vine din p = o + (q − o) / z.
  const back = (q: number, origin: number): number => origin + (q - origin) / f.zoom;
  const left = (back(0, f.x * frame.w) - ox) / iw;
  const right = (back(frame.w, f.x * frame.w) - ox) / iw;
  const top = (back(0, f.y * frame.h) - oy) / ih;
  const bottom = (back(frame.h, f.y * frame.h) - oy) / ih;
  return { left, top, width: right - left, height: bottom - top };
}

describe('visibleRect = ce arată CSS-ul', () => {
  const cases: Array<[Framing, { w: number; h: number }]> = [
    [{ x: 0.5, y: 0.5, zoom: 1 }, { w: 1600, h: 900 }],
    [{ x: 0.2, y: 0.9, zoom: 1 }, { w: 1600, h: 900 }],
    [{ x: 0.8, y: 0.1, zoom: 2.3 }, { w: 600, h: 900 }],
    [{ x: 0, y: 1, zoom: 3 }, { w: 1000, h: 1000 }],
    [{ x: 0.37, y: 0.61, zoom: 1.45 }, { w: 3000, h: 1000 }],
  ];
  for (const [kind, ratio] of Object.entries(COVER_RATIO)) {
    for (const [framing, natural] of cases) {
      it(`${kind}: ${JSON.stringify(framing)} pe ${natural.w}×${natural.h}`, () => {
        const frame = { w: 400, h: 400 / ratio };
        const expected = cssVisible(framing, frame, natural);
        const got = visibleRect(framing, ratio, natural.w / natural.h);
        expect(got.left).toBeCloseTo(expected.left, 9);
        expect(got.top).toBeCloseTo(expected.top, 9);
        expect(got.width).toBeCloseTo(expected.width, 9);
        expect(got.height).toBeCloseTo(expected.height, 9);
      });
    }
  }
});

describe('selecția pe imaginea întreagă', () => {
  // Imagine 16:9, rama paginii 4:3: la zoom 1 se vede toată înălțimea și 75% din lățime.
  const imageRatio = 16 / 9;
  const hero = COVER_RATIO.hero;

  it('coverBase: latura „plină" e cea pe care imaginea e mai îngustă', () => {
    expect(coverBase(hero, imageRatio)).toEqual({ width: 0.75, height: 1 });
    const card = coverBase(COVER_RATIO.card, 9 / 16);
    expect(card.width).toBe(1);
    expect(card.height).toBeCloseTo(9 / 32);
  });

  it('moveSelection: mută chenarul și se oprește la margine', () => {
    // Rezervă orizontală 0.25: +0.125 = de la centru până la margine.
    expect(moveSelection(DEFAULT_FRAMING, { du: 0.125, dv: 0 }, hero, imageRatio).x).toBeCloseTo(1);
    expect(moveSelection(DEFAULT_FRAMING, { du: -0.0625, dv: 0 }, hero, imageRatio).x).toBeCloseTo(0.25);
    expect(moveSelection(DEFAULT_FRAMING, { du: 5, dv: 0 }, hero, imageRatio).x).toBe(1);
    // Fără rezervă verticală la zoom 1: y nu se schimbă.
    expect(moveSelection(DEFAULT_FRAMING, { du: 0, dv: 0.3 }, hero, imageRatio).y).toBe(0.5);
  });

  it('centerSelectionAt: chenarul se centrează pe punct (cât permit marginile)', () => {
    const next = centerSelectionAt({ x: 0.5, y: 0.5, zoom: 2 }, { u: 0.3, v: 0.4 }, hero, imageRatio);
    const r = visibleRect(next, hero, imageRatio);
    expect(r.left + r.width / 2).toBeCloseTo(0.3);
    expect(r.top + r.height / 2).toBeCloseTo(0.4);
    const edge = visibleRect(
      centerSelectionAt({ x: 0.5, y: 0.5, zoom: 2 }, { u: 0, v: 1 }, hero, imageRatio),
      hero,
      imageRatio,
    );
    expect(edge.left).toBeCloseTo(0);
    expect(edge.top + edge.height).toBeCloseTo(1);
  });

  it('resizeSelection: colțul opus rămâne pe loc, mărimea dă zoom-ul', () => {
    // De la zoom 1: chenar [0.125, 0.875] × [0, 1]. Tragem colțul SE spre (0.5, 0.2).
    const next = resizeSelection(DEFAULT_FRAMING, 'se', { u: 0.5, v: 0.2 }, hero, imageRatio);
    const r = visibleRect(next, hero, imageRatio);
    // Lățimea cerută: max(0.5 − 0.125, 0.2 · 0.75) = 0.375 ⇒ zoom 2.
    expect(next.zoom).toBeCloseTo(2);
    expect(r.left).toBeCloseTo(0.125);
    expect(r.top).toBeCloseTo(0);
    expect(r.width).toBeCloseTo(0.375);
  });

  it('resizeSelection: din colțul NW ancora e colțul SE', () => {
    const start = { x: 0.5, y: 0.5, zoom: 2 };
    const before = visibleRect(start, hero, imageRatio);
    const next = resizeSelection(start, 'nw', { u: before.left - 0.05, v: before.top }, hero, imageRatio);
    const after = visibleRect(next, hero, imageRatio);
    expect(after.left + after.width).toBeCloseTo(before.left + before.width);
    expect(after.top + after.height).toBeCloseTo(before.top + before.height);
    expect(next.zoom).toBeLessThan(2);
  });

  it('resizeSelection: zoom-ul rămâne în 1..3', () => {
    expect(resizeSelection(DEFAULT_FRAMING, 'se', { u: 0.126, v: 0.001 }, hero, imageRatio).zoom).toBe(3);
    expect(resizeSelection({ x: 0.5, y: 0.5, zoom: 2 }, 'se', { u: 9, v: 9 }, hero, imageRatio).zoom).toBe(1);
  });

  it('zoomBy: înmulțește și limitează', () => {
    expect(zoomBy(DEFAULT_FRAMING, 2).zoom).toBe(2);
    expect(zoomBy(DEFAULT_FRAMING, 0.5).zoom).toBe(1);
    expect(zoomBy({ ...DEFAULT_FRAMING, zoom: 2 }, 10).zoom).toBe(3);
    expect(zoomBy(DEFAULT_FRAMING, Number.NaN)).toBe(DEFAULT_FRAMING);
  });
});
