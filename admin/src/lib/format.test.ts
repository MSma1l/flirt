import { describe, expect, it } from 'vitest';

import {
  dayBoundaryIso,
  dayKey,
  formatDateTime,
  formatMoney,
  formatTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from './format';

// Testele nu depind de fusul mașinii: ora afișată e MEREU cea din Chișinău.
describe('format — fusul Europe/Chisinau', () => {
  it('afișează ora din Chișinău (vara UTC+3, iarna UTC+2)', () => {
    expect(formatTime('2026-07-01T18:00:00Z')).toBe('21:00');
    expect(formatTime('2026-01-15T18:00:00Z')).toBe('20:00');
    expect(formatDateTime('2026-07-01T22:30:00Z')).toContain('02.07.2026');
  });

  it('datetime-local ↔ ISO UTC dus-întors în ora din Chișinău', () => {
    expect(toDateTimeLocalValue('2026-07-01T18:00:00Z')).toBe('2026-07-01T21:00');
    expect(fromDateTimeLocalValue('2026-07-01T21:00')).toBe('2026-07-01T18:00:00.000Z');
    expect(fromDateTimeLocalValue('2026-01-15T20:00')).toBe('2026-01-15T18:00:00.000Z');
    expect(fromDateTimeLocalValue('nu e dată')).toBe('');
    // Ziua schimbării orei (29 martie 2026, 03:00 → 04:00 în Chișinău).
    expect(fromDateTimeLocalValue('2026-03-29T12:00')).toBe('2026-03-29T09:00:00.000Z');
  });

  it('limitele unei zile pentru filtre (inclusiv toată ziua de sfârșit)', () => {
    expect(dayBoundaryIso('2026-10-17')).toBe('2026-10-16T21:00:00.000Z');
    expect(dayBoundaryIso('2026-10-17', true)).toBe('2026-10-17T20:59:59.999Z');
    expect(dayBoundaryIso('')).toBe('');
  });

  it('cheia zilei urmează Chișinăul, nu UTC', () => {
    expect(dayKey('2026-07-01T22:30:00Z')).toBe('2026-07-02');
  });
});

describe('formatMoney', () => {
  it('„lei"/„MDL" devin MDL, fără zecimale inutile', () => {
    expect(formatMoney(150, 'lei')).toMatch(/^150\sMDL$/);
    expect(formatMoney(150, 'MDL')).toMatch(/^150\sMDL$/);
    expect(formatMoney(12.5, 'lei')).toMatch(/^12,50\sMDL$/);
    expect(formatMoney(1500, null)).toMatch(/MDL$/);
  });

  it('o monedă necunoscută nu aruncă', () => {
    expect(formatMoney(10, 'xx')).toBe('10 xx');
    expect(formatMoney(25, 'EUR')).toContain('25');
  });
});
