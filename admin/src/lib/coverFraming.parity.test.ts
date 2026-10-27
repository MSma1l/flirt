/**
 * Panoul și miniapp-ul calculează încadrarea copertei cu DOUĂ module separate
 * (`admin/src/lib/coverFraming.ts` și `miniapp/src/features/events/coverFraming.ts`).
 * Testul le importă pe amândouă și cere același rezultat pentru aceleași valori:
 * dacă cineva schimbă formula sau proporțiile ramelor doar într-o parte, adminul
 * ar vedea altceva decât utilizatorul — și testul cade.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as miniapp from '../../../miniapp/src/features/events/coverFraming';
import * as admin from './coverFraming';

/** Valori „ciudate" incluse intenționat: margini, în afara intervalului, lipsă. */
const SAMPLES: Array<{ x?: number; y?: number; zoom?: number }> = [
  {},
  { x: 0.5, y: 0.5, zoom: 1 },
  { x: 0, y: 1, zoom: 3 },
  { x: 0.123456, y: 0.987654, zoom: 1.23456 },
  { x: 0.2, y: 0.75, zoom: 2 },
  { x: -1, y: 4, zoom: 9 },
  { x: Number.NaN, y: 0.3, zoom: 0.2 },
  { x: 1 / 3, y: 2 / 3, zoom: 2.999 },
];

describe('coverFraming: panou ≡ miniapp', () => {
  it('aceleași proporții de ramă și aceleași limite', () => {
    expect(admin.COVER_RATIO).toEqual(miniapp.COVER_RATIO);
    expect(admin.COVER_FOCUS_DEFAULT).toBe(miniapp.COVER_FOCUS_DEFAULT);
    expect(admin.COVER_ZOOM_MIN).toBe(miniapp.COVER_ZOOM_MIN);
    expect(admin.COVER_ZOOM_MAX).toBe(miniapp.COVER_ZOOM_MAX);
  });

  it('ramele din CSS-ul miniapp-ului au proporțiile din `COVER_RATIO` și `object-fit: cover`', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../miniapp/src/features/events/events.css'),
      'utf8',
    );
    const rule = (selector: string): string => {
      const match = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
      return match?.[1] ?? '';
    };
    const ratio = (body: string): number => {
      const m = body.match(/aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/);
      return m ? Number(m[1]) / Number(m[2]) : Number.NaN;
    };
    expect(ratio(rule('.ev-card__cover'))).toBeCloseTo(admin.COVER_RATIO.card);
    expect(ratio(rule('.ev-hero'))).toBeCloseTo(admin.COVER_RATIO.hero);
    expect(rule('.ev-card__cover-img')).toMatch(/object-fit:\s*cover/);
    expect(rule('.ev-hero__img')).toMatch(/object-fit:\s*cover/);
  });

  for (const sample of SAMPLES) {
    it(`același stil pentru ${JSON.stringify(sample)}`, () => {
      const fromAdmin = admin.coverImageStyle(sample);
      const fromMiniapp = miniapp.coverImageStyle({
        coverFocusX: sample.x,
        coverFocusY: sample.y,
        coverZoom: sample.zoom,
      });
      // `object-fit: cover` stă în CSS-ul miniapp-ului (`.ev-card__cover-img`,
      // `.ev-hero__img`); panoul îl pune inline. Restul trebuie să fie identic.
      expect(fromAdmin.objectFit).toBe('cover');
      expect({
        objectPosition: fromAdmin.objectPosition,
        transformOrigin: fromAdmin.transformOrigin,
        transform: fromAdmin.transform,
      }).toEqual(fromMiniapp);
      expect(admin.normalizeFraming(sample)).toEqual(
        miniapp.normalizeFraming({ coverFocusX: sample.x, coverFocusY: sample.y, coverZoom: sample.zoom }),
      );
    });
  }
});
