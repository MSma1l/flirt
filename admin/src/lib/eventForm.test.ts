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
  canAddTier,
  hasValidCoords,
  isUpcoming,
  moveTier,
  newTierRow,
  selectEvents,
  shownAttendees,
  toForm,
  toPayload,
  validate,
  validateTiers,
  warnings,
  withTiers,
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

  it('respinge un tip cu preț negativ și biletele fără monedă', () => {
    const negative = form({ ticket_tiers: [newTierRow({ name: 'VIP', price: '-5' })] });
    expect(validate(negative).ticket_tiers).toBeDefined();
    const noCurrency = form({
      ticket_tiers: [newTierRow({ name: 'VIP', price: '50' })],
      ticket_currency: '',
    });
    expect(validate(noCurrency).ticket_currency).toBeDefined();
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
    expect(payload.ticket_tiers).toEqual([]);
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
        ticket_tiers: [newTierRow({ name: ' Standard ', price: '50' })],
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
      ticket_tiers: [{ id: null, name: 'Standard', price: 50, capacity: null, description: null }],
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
      // Eveniment vechi fără tipuri: prețul unic devine un tip implicit.
      ticket_tiers: [{ id: null, name: 'Standard', price: 80, capacity: null, description: null }],
      ticket_currency: 'MDL',
    });
  });
});

describe('tipuri de bilet (până la 4 prețuri)', () => {
  const tier = (id: string, name: string, price: number, position: number, extra = {}) => ({
    id,
    name,
    price,
    position,
    capacity: null,
    description: null,
    sold: 0,
    ...extra,
  });

  it('toForm păstrează tipurile (ordine, id, plafon, vândute) și le trimite înapoi', () => {
    const source = event({
      ticket_price: 100,
      ticket_currency: 'lei',
      ticket_tiers: [
        tier('t-vip', 'VIP', 300, 1, { capacity: 20, sold: 4, description: 'Lounge' }),
        tier('t-early', 'Early bird', 100, 0),
      ],
    });
    const state = toForm(source);
    expect(state.ticket_tiers.map((row) => row.name)).toEqual(['Early bird', 'VIP']);
    expect(state.ticket_tiers[1]).toMatchObject({ id: 't-vip', capacity: '20', sold: 4 });
    expect(toPayload(state).ticket_tiers).toEqual([
      { id: 't-early', name: 'Early bird', price: 100, capacity: null, description: null },
      { id: 't-vip', name: 'VIP', price: 300, capacity: 20, description: 'Lounge' },
    ]);
  });

  it('validează fiecare rând: nume obligatoriu și unic, preț, plafon ≥ vândute, HTML', () => {
    const errors = validateTiers([
      newTierRow({ name: '', price: '' }),
      newTierRow({ name: 'VIP', price: '10' }),
      newTierRow({ name: 'vip', price: '2000000' }),
      newTierRow({ name: 'Early', price: '5', capacity: '2', sold: 3 }),
      newTierRow({ name: 'X', price: '5', description: '<b>bold</b>' }),
    ]);
    expect(errors[0]?.name).toBeDefined();
    expect(errors[0]?.price).toBeDefined();
    expect(errors[1]).toEqual({});
    expect(errors[2]?.name).toBeDefined();
    expect(errors[2]?.price).toBeDefined();
    expect(errors[3]?.capacity).toBeDefined();
    expect(errors[4]?.description).toBeDefined();
    expect(validateTiers([newTierRow({ name: 'A'.repeat(EVENT_LIMITS.tierName + 1), price: '1' })])[0]?.name)
      .toBeDefined();
  });

  it('maximum 4 tipuri; reordonarea și prețul minim derivat', () => {
    const rows = [1, 2, 3, 4].map((n) => newTierRow({ name: `T${n}`, price: String(n * 10) }));
    expect(canAddTier(rows.slice(0, 3))).toBe(true);
    expect(canAddTier(rows)).toBe(false);
    expect(validate(form({ ticket_tiers: [...rows, newTierRow({ name: 'T5', price: '1' })] })).ticket_tiers)
      .toBeDefined();

    const moved = moveTier(rows, 3, -1);
    expect(moved.map((row) => row.name)).toEqual(['T1', 'T2', 'T4', 'T3']);
    expect(moveTier(rows, 0, -1)).toBe(rows);

    expect(withTiers(form(), rows).ticket_price).toBe('10');
    expect(withTiers(form(), []).ticket_price).toBe('');
  });
});

describe('ticket_sales_end_at (închiderea vânzării online)', () => {
  it('gol → null în payload și fără eroare', () => {
    expect(validate(form()).ticket_sales_end_at).toBeUndefined();
    expect(toPayload(form()).ticket_sales_end_at).toBeNull();
  });

  it('acceptă înainte de start și exact la start + 12h', () => {
    expect(validate(form({ ticket_sales_end_at: '2030-05-01T19:00' }))).toEqual({});
    expect(validate(form({ ticket_sales_end_at: '2030-05-02T09:00' }))).toEqual({});
    expect(toPayload(form({ ticket_sales_end_at: '2030-05-01T19:00' })).ticket_sales_end_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T.*Z$/,
    );
  });

  it('refuză mai târziu de start + 12h (oglinda celui 422 din backend)', () => {
    expect(validate(form({ ticket_sales_end_at: '2030-05-02T09:01' })).ticket_sales_end_at).toBe(
      'Vânzarea online trebuie să se închidă cel târziu la 12 ore după începutul evenimentului.',
    );
  });

  it('dus-întors prin `toForm`', () => {
    const source = event({ ticket_sales_end_at: '2030-05-01T16:00:00.000Z' });
    expect(toPayload(toForm(source)).ticket_sales_end_at).toBe('2030-05-01T16:00:00.000Z');
    expect(toForm(event()).ticket_sales_end_at).toBe('');
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

describe('ticket_capacity (capacitatea de bilete)', () => {
  it('gol → null (nelimitat) în payload și fără eroare', () => {
    expect(validate(form()).ticket_capacity).toBeUndefined();
    expect(toPayload(form()).ticket_capacity).toBeNull();
  });

  it('acceptă un întreg ≥ 1 și îl trimite ca număr', () => {
    expect(validate(form({ ticket_capacity: '150' }))).toEqual({});
    expect(toPayload(form({ ticket_capacity: '150' })).ticket_capacity).toBe(150);
  });

  it('respinge 0, negativ, fracționar și text', () => {
    for (const raw of ['0', '-3', '2.5', 'abc']) {
      expect(validate(form({ ticket_capacity: raw })).ticket_capacity).toBe(
        'Capacitatea trebuie să fie un număr întreg de cel puțin 1 (sau gol = nelimitat).',
      );
    }
  });

  it('respinge o capacitate sub biletele deja vândute (oglinda 409 capacity_below_sold)', () => {
    expect(validate(form({ ticket_capacity: '5' }), 'ro', 8).ticket_capacity).toBe(
      'Capacitatea nu poate fi mai mică decât biletele deja vândute (8).',
    );
    expect(validate(form({ ticket_capacity: '8' }), 'ro', 8).ticket_capacity).toBeUndefined();
  });

  it('dus-întors prin `toForm`', () => {
    expect(toPayload(toForm(event({ ticket_capacity: 120 }))).ticket_capacity).toBe(120);
    expect(toForm(event({ ticket_capacity: null })).ticket_capacity).toBe('');
    expect(toForm(event()).ticket_capacity).toBe('');
  });
});

describe('încadrarea copertei', () => {
  it('formular nou: centru, zoom 1 — trimise ca numere', () => {
    expect(toPayload(form())).toMatchObject({ cover_focus_x: 0.5, cover_focus_y: 0.5, cover_zoom: 1 });
  });

  it('dus-întors prin `toForm` păstrează încadrarea', () => {
    const payload = toPayload(toForm(event({ cover_focus_x: 0.2, cover_focus_y: 0.7, cover_zoom: 1.8 })));
    expect(payload).toMatchObject({ cover_focus_x: 0.2, cover_focus_y: 0.7, cover_zoom: 1.8 });
  });

  it('un backend vechi (fără câmpuri) dă centrul; valorile aberante sunt aduse în limite', () => {
    expect(toForm(event())).toMatchObject({ cover_focus_x: 0.5, cover_focus_y: 0.5, cover_zoom: 1 });
    expect(toPayload(form({ cover_focus_x: 3, cover_focus_y: -1, cover_zoom: 9 }))).toMatchObject({
      cover_focus_x: 1,
      cover_focus_y: 0,
      cover_zoom: 3,
    });
  });
});

describe('participanți afișați', () => {
  it('gol → null (numărul real), fără eroare', () => {
    expect(validate(form()).displayed_attendee_count).toBeUndefined();
    expect(toPayload(form()).displayed_attendee_count).toBeNull();
  });

  it('acceptă 0 și întregi pozitivi până la plafon', () => {
    expect(validate(form({ displayed_attendee_count: '0' }))).toEqual({});
    expect(toPayload(form({ displayed_attendee_count: '150' })).displayed_attendee_count).toBe(150);
    expect(validate(form({ displayed_attendee_count: '100000' }))).toEqual({});
  });

  it('respinge negativ, fracționar, text și peste plafon', () => {
    for (const raw of ['-1', '2.5', 'abc', '100001']) {
      expect(validate(form({ displayed_attendee_count: raw })).displayed_attendee_count).toBe(
        'Participanții afișați: un număr întreg între 0 și 100000 (sau gol = numărul real).',
      );
    }
  });

  it('userii văd max(real, setat)', () => {
    expect(shownAttendees(3, 50)).toBe(50);
    expect(shownAttendees(80, 50)).toBe(80);
    expect(shownAttendees(7, null)).toBe(7);
  });

  it('dus-întors prin `toForm`', () => {
    expect(toForm(event({ displayed_attendee_count: 40 })).displayed_attendee_count).toBe('40');
    expect(toForm(event({ displayed_attendee_count: null })).displayed_attendee_count).toBe('');
  });
});
