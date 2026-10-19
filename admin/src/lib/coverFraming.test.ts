import { describe, expect, it } from 'vitest';

import { coverImageStyle, DEFAULT_FRAMING, normalizeFraming, panFocus } from './coverFraming';

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
