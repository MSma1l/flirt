/** Fereastra de vânzare online: logica pură, tolerantă la serverele vechi. */
import { describe, expect, it } from 'vitest';

import { computeSalesState, formatCountdown, salesNotice, salesRefusal } from '../ticketSales';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('computeSalesState', () => {
  it('fără câmpuri (server vechi) vânzarea e deschisă și fără ceas', () => {
    expect(computeSalesState({}, NOW)).toEqual({
      endAt: null,
      closed: false,
      soldOut: false,
      paused: false,
      block: null,
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

  it('„închis" de server înainte de ora de închidere înseamnă bilete epuizate', () => {
    const soldOut = computeSalesState({ ticketSalesEndAt: new Date(NOW + HOUR).toISOString(), ticketSalesOpen: false }, NOW);
    expect(soldOut).toMatchObject({ closed: true, soldOut: true });
    // După ora de închidere e pur și simplu închis, nu epuizat.
    const late = computeSalesState({ ticketSalesEndAt: new Date(NOW - HOUR).toISOString(), ticketSalesOpen: false }, NOW);
    expect(late).toMatchObject({ closed: true, soldOut: false });
    // Fără oră anunțată nu putem ști motivul → mesajul neutru.
    expect(computeSalesState({ ticketSalesOpen: false }, NOW).soldOut).toBe(false);
  });

  it('pauza globală e un motiv separat — nu „epuizat", nu „închis"', () => {
    const endAt = new Date(NOW + HOUR).toISOString();
    // Semnătura sold-out-ului (închis înainte de oră), dar cu pauza anunțată.
    const paused = computeSalesState({ ticketSalesEndAt: endAt, ticketSalesOpen: false, ticketSalesPaused: true }, NOW);
    expect(paused).toMatchObject({ closed: true, paused: true, soldOut: false, block: 'paused', msLeft: null });
    expect(computeSalesState({ ticketSalesOpen: false, ticketSalesPaused: true }, NOW).block).toBe('paused');
    // Fără pauză, aceleași câmpuri rămân epuizat / închis.
    expect(computeSalesState({ ticketSalesEndAt: endAt, ticketSalesOpen: false }, NOW).block).toBe('soldOut');
    expect(computeSalesState({ ticketSalesOpen: false }, NOW).block).toBe('closed');
    // Ora trecută: vânzarea s-a încheiat oricum, pauza nu mai contează.
    const late = new Date(NOW - HOUR).toISOString();
    expect(computeSalesState({ ticketSalesEndAt: late, ticketSalesOpen: false, ticketSalesPaused: true }, NOW).block).toBe('closed');
    // `false` / lipsă = nu e pauză.
    expect(computeSalesState({ ticketSalesOpen: true, ticketSalesPaused: false }, NOW).block).toBeNull();
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

describe('salesRefusal / salesNotice', () => {
  const err = (status: number, data: unknown) => ({ response: { status, data } });

  it('traduce refuzurile serverului în motivul blocării', () => {
    expect(salesRefusal(err(409, { detail: 'x', code: 'online_sales_disabled' }))).toBe('paused');
    expect(salesRefusal(err(409, { detail: { code: 'online_sales_disabled' } }))).toBe('paused');
    expect(salesRefusal(err(409, { detail: 'x', code: 'ticket_sales_closed' }))).toBe('closed');
    expect(salesRefusal(err(409, { detail: 'Nu mai sunt bilete' }))).toBe('soldOut');
    expect(salesRefusal(err(500, {}))).toBeNull();
    expect(salesRefusal(new Error('network'))).toBeNull();
  });

  it('fiecare motiv are mesajul lui', () => {
    expect(salesNotice('paused').body).toBe('screens:events.sales.pausedBody');
    expect(salesNotice('paused', true).body).toBe('screens:events.sales.pausedBody');
    expect(salesNotice('soldOut').title).toBe('screens:events.sales.soldOutTitle');
    expect(salesNotice('closed').body).toBe('screens:events.sales.closedBody');
    expect(salesNotice('closed', true).body).toBe('screens:events.sales.closedError');
  });
});
