/**
 * Regulile de eveniment, testate direct (fără DOM).
 *
 * Fiecare caz de aici are o pereche pe backend: dacă una dintre limite se
 * schimbă în `backend/app/schemas/admin.py`, testul ăsta trebuie să pice ÎNAINTE
 * ca panoul să înceapă să primească 422 în producție.
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_FORM,
  EVENT_LIMITS,
  hasValidCoords,
  isUpcoming,
  selectEvents,
  toForm,
  toPayload,
  validate,
  warnings,
  type FormState,
} from './eventForm';
import type { AdminEvent } from '../api/types';

/** Un formular minim VALID (titlu + oraș + dată), peste care punem cazul testat. */
function form(overrides: Partial<FormState> = {}): FormState {
  return {
    ...EMPTY_FORM,
    title: 'Flirt Party',
    city: 'Chișinău',
    starts_at: '2030-05-01T21:00',
    ...overrides,
  };
}

function event(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: 'e-1',
    title: 'Eveniment',
    description: null,
    starts_at: '2030-05-01T18:00:00Z',
    city: 'Chișinău',
    venue: null,
    lat: null,
    lng: null,
    kind: 'flirt_party',
    cover_url: null,
    attendee_count: 0,
    promo_discount_percent: null,
    promo_code: null,
    promo_description: null,
    ticket_price: null,
    ticket_currency: null,
    ticket_order_count: 0,
    ticket_approved_count: 0,
    ...overrides,
  };
}

describe('validate — câmpuri obligatorii', () => {
  it('acceptă un formular minim complet', () => {
    expect(validate(form())).toEqual({});
  });

  it('respinge titlul/orașul/data lipsă', () => {
    const errors = validate({ ...EMPTY_FORM });
    expect(errors.title).toBeDefined();
    expect(errors.city).toBeDefined();
    expect(errors.starts_at).toBeDefined();
  });

  it('respinge un titlu format doar din spații (backendul face trim + min_length=1)', () => {
    expect(validate(form({ title: '   ' })).title).toBeDefined();
  });

  it('respinge textul peste limitele backendului', () => {
    expect(validate(form({ title: 'x'.repeat(EVENT_LIMITS.title + 1) })).title).toBeDefined();
    expect(validate(form({ city: 'x'.repeat(EVENT_LIMITS.city + 1) })).city).toBeDefined();
    expect(validate(form({ venue: 'x'.repeat(EVENT_LIMITS.venue + 1) })).venue).toBeDefined();
    expect(
      validate(form({ description: 'x'.repeat(EVENT_LIMITS.description + 1) })).description,
    ).toBeDefined();
    expect(
      validate(form({ promo_code: 'x'.repeat(EVENT_LIMITS.promoCode + 1) })).promo_code,
    ).toBeDefined();
  });

  it('respinge marcajele HTML, ca validatorii anti-XSS ai backendului', () => {
    expect(validate(form({ title: '<script>alert(1)</script>' })).title).toBeDefined();
    expect(validate(form({ description: 'Petrecere <b>tare</b>' })).description).toBeDefined();
  });
});

describe('validate — coordonate', () => {
  it('respinge coordonate în afara intervalelor geografice', () => {
    expect(validate(form({ lat: '500', lng: '28.8' })).lat).toBeDefined();
    expect(validate(form({ lat: '47.02', lng: '-200' })).lng).toBeDefined();
  });

  it('respinge o singură coordonată (perechea incompletă nu ajunge pe hartă)', () => {
    expect(validate(form({ lat: '47.0245' })).lng).toBeDefined();
    expect(validate(form({ lng: '28.8322' })).lat).toBeDefined();
  });

  it('acceptă perechea completă', () => {
    expect(validate(form({ lat: '47.0245', lng: '28.8322' }))).toEqual({});
  });
});

describe('validate — promo, bilet, copertă', () => {
  it('respinge reducerea în afara 0..100 și pe cea fracționară', () => {
    expect(validate(form({ promo_discount_percent: '150' })).promo_discount_percent).toBeDefined();
    expect(validate(form({ promo_discount_percent: '-1' })).promo_discount_percent).toBeDefined();
    expect(validate(form({ promo_discount_percent: '10.5' })).promo_discount_percent).toBeDefined();
    expect(validate(form({ promo_discount_percent: '10' })).promo_discount_percent).toBeUndefined();
  });

  it('respinge prețul negativ și prețul fără monedă', () => {
    expect(validate(form({ ticket_price: '-5' })).ticket_price).toBeDefined();
    expect(validate(form({ ticket_price: '50', ticket_currency: '' })).ticket_currency).toBeDefined();
  });

  it('respinge o copertă care nu e adresă http(s)', () => {
    expect(validate(form({ cover_url: 'poster.jpg' })).cover_url).toBeDefined();
    expect(validate(form({ cover_url: 'javascript:alert(1)' })).cover_url).toBeDefined();
    expect(validate(form({ cover_url: 'https://cdn.exemplu.md/a.jpg' })).cover_url).toBeUndefined();
  });
});

describe('warnings — ce trece, dar arată prost în aplicație', () => {
  it('avertizează că fără coordonate evenimentul nu apare pe hartă', () => {
    expect(warnings(form()).join(' ')).toContain('hart');
  });

  it('nu mai avertizează despre hartă când coordonatele sunt complete', () => {
    const list = warnings(form({ lat: '47.0245', lng: '28.8322' }));
    expect(list.some((line) => line.includes('NU apare pe harta'))).toBe(false);
  });

  it('avertizează că reducerea fără cod nu se afișează (regula din Mini App)', () => {
    const list = warnings(form({ promo_discount_percent: '10' }));
    expect(list.some((line) => line.includes('fără cod promo'))).toBe(true);
  });

  it('avertizează pentru o dată din trecut', () => {
    const list = warnings(form({ starts_at: '2020-01-01T20:00' }));
    expect(list.some((line) => line.includes('TRECUT'))).toBe(true);
  });
});

describe('toPayload', () => {
  it('trimite null (nu string gol) pentru câmpurile opționale golite', () => {
    const payload = toPayload(form());
    expect(payload.description).toBeNull();
    expect(payload.venue).toBeNull();
    expect(payload.cover_url).toBeNull();
    expect(payload.promo_code).toBeNull();
    expect(payload.lat).toBeNull();
    expect(payload.lng).toBeNull();
    expect(payload.ticket_price).toBeNull();
    expect(payload.ticket_currency).toBeNull();
  });

  it('duce toate câmpurile completate în payload', () => {
    const payload = toPayload(
      form({
        description: ' Petrecere ',
        venue: 'Club Nova',
        kind: 'concert',
        cover_url: 'https://cdn.exemplu.md/a.jpg',
        lat: '47.0245',
        lng: '28.8322',
        promo_discount_percent: '10',
        promo_code: 'FLIRT10',
        promo_description: 'Arată codul la intrare.',
        ticket_price: '50',
        ticket_currency: 'lei',
      }),
    );
    expect(payload).toMatchObject({
      title: 'Flirt Party',
      city: 'Chișinău',
      description: 'Petrecere',
      venue: 'Club Nova',
      kind: 'concert',
      cover_url: 'https://cdn.exemplu.md/a.jpg',
      lat: 47.0245,
      lng: 28.8322,
      promo_discount_percent: 10,
      promo_code: 'FLIRT10',
      ticket_price: 50,
      ticket_currency: 'lei',
    });
    // `datetime-local` (ora locală) → ISO UTC, forma cerută de backend.
    expect(payload.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('dus-întors prin `toForm` păstrează datele unui eveniment existent', () => {
    const source = event({
      description: 'Text',
      venue: 'Club Nova',
      lat: 47.0245,
      lng: 28.8322,
      cover_url: 'https://cdn.exemplu.md/a.jpg',
      promo_discount_percent: 15,
      promo_code: 'F15',
      ticket_price: 80,
      ticket_currency: 'MDL',
    });
    expect(toPayload(toForm(source))).toMatchObject({
      title: source.title,
      city: source.city,
      description: 'Text',
      venue: 'Club Nova',
      lat: 47.0245,
      lng: 28.8322,
      promo_discount_percent: 15,
      promo_code: 'F15',
      ticket_price: 80,
      ticket_currency: 'MDL',
    });
  });
});

describe('hasValidCoords', () => {
  it('cere ambele coordonate, în intervalele reale', () => {
    expect(hasValidCoords(47.02, 28.83)).toBe(true);
    expect(hasValidCoords(47.02, null)).toBe(false);
    expect(hasValidCoords(null, 28.83)).toBe(false);
    expect(hasValidCoords(500, 28.83)).toBe(false);
    expect(hasValidCoords(Number.NaN, 28.83)).toBe(false);
  });
});

describe('selectEvents — căutare, filtrare, sortare', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const list = [
    event({ id: 'a', title: 'Flirt Party vara', starts_at: '2026-07-01T18:00:00Z' }),
    event({ id: 'b', title: 'Concert toamnă', starts_at: '2026-09-01T18:00:00Z', city: 'Bălți' }),
    event({ id: 'c', title: 'Petrecere veche', starts_at: '2026-01-01T18:00:00Z' }),
    event({ id: 'd', title: 'Bar seara', starts_at: '2026-05-01T18:00:00Z', venue: 'Club Nova' }),
  ];

  it('sortează crescător după dată (cele mai apropiate întâi)', () => {
    expect(selectEvents(list, { now }).map((e) => e.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('sortează descrescător la cerere', () => {
    expect(selectEvents(list, { sort: 'latest', now }).map((e) => e.id)).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
  });

  it('separă viitorul de trecut', () => {
    expect(selectEvents(list, { filter: 'upcoming', now }).map((e) => e.id)).toEqual(['a', 'b']);
    expect(selectEvents(list, { filter: 'past', now }).map((e) => e.id)).toEqual(['c', 'd']);
  });

  it('caută în titlu, oraș și locație, ignorând diacriticele', () => {
    expect(selectEvents(list, { search: 'flirt', now }).map((e) => e.id)).toEqual(['a']);
    expect(selectEvents(list, { search: 'balti', now }).map((e) => e.id)).toEqual(['b']);
    expect(selectEvents(list, { search: 'club nova', now }).map((e) => e.id)).toEqual(['d']);
    expect(selectEvents(list, { search: 'inexistent', now })).toEqual([]);
  });
});

describe('isUpcoming', () => {
  it('compară cu momentul dat', () => {
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(isUpcoming(event({ starts_at: '2026-07-01T00:00:00Z' }), now)).toBe(true);
    expect(isUpcoming(event({ starts_at: '2026-05-01T00:00:00Z' }), now)).toBe(false);
  });
});
