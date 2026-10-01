/** Fereastra de vânzare online: logica pură, tolerantă la serverele vechi. */
import { describe, expect, it } from 'vitest';

import { computeSalesState, formatCountdown } from '../ticketSales';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('computeSalesState', () => {
  it('fără câmpuri (server vechi) vânzarea e deschisă și fără ceas', () => {
    expect(computeSalesState({}, NOW)).toEqual({
      endAt: null,
      closed: false,
      msLeft: null,
      showCountdown: false,
    });
  });

  it('numărătoarea apare doar sub 24 h', () => {
    const far = computeSalesState({ ticketSalesEndAt: new Date(NOW + 30 * HOUR).toISOString(), ticketSalesOpen: true }, NOW);
    expect(far.closed).toBe(false);
    expect(far.showCountdown).toBe(false);

    const near = computeSalesState({ ticketSalesEndAt: new Date(NOW + 2 * HOUR).toISOString(), ticketSalesOpen: true }, NOW);
    expect(near.showCountdown).toBe(true);
    expect(near.msLeft).toBe(2 * HOUR);
  });

  it('verdictul „închis" al serverului câștigă; ora trecută închide și local', () => {
    expect(computeSalesState({ ticketSalesEndAt: new Date(NOW + HOUR).toISOString(), ticketSalesOpen: false }, NOW).closed).toBe(true);
    expect(computeSalesState({ ticketSalesEndAt: new Date(NOW - 1).toISOString() }, NOW).closed).toBe(true);
  });

  it('o dată nevalidă e ignorată, nu închide vânzarea', () => {
    expect(computeSalesState({ ticketSalesEndAt: 'mâine' }, NOW).closed).toBe(false);
  });
});

describe('formatCountdown', () => {
  it('scrie ore:minute:secunde, niciodată negativ', () => {
    expect(formatCountdown(5 * HOUR + 7 * 60 * 1000 + 9000)).toBe('05:07:09');
    expect(formatCountdown(-5)).toBe('00:00:00');
  });
});
