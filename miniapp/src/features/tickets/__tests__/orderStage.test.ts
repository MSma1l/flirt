/** Etapele comenzii, starea biletului și citirea codurilor de refuz. */
import { describe, expect, it } from 'vitest';

import {
  apiErrorCode,
  formatTime,
  hasEventStarted,
  isEventStartedError,
  isTicketSalesClosedError,
  orderStage,
  passStatusOf,
  shortTicketCode,
  stepStates,
  summarizeOrder,
} from '../orderStage';

describe('orderStage', () => {
  it('pune ambele fluxuri pe aceleași patru etape', () => {
    expect(orderStage('awaiting_payment')).toBe('ordered');
    expect(orderStage('pending_payment')).toBe('ordered');
    expect(orderStage('additional_information_required')).toBe('ordered');
    expect(orderStage('payment_declared')).toBe('review');
    expect(orderStage('payment_proof_submitted')).toBe('review');
    expect(orderStage('under_review')).toBe('review');
    expect(orderStage('approved')).toBe('approved');
    expect(orderStage('rejected')).toBe('rejected');
    expect(orderStage('cancelled')).toBe('cancelled');
  });

  it('respingerea oprește cronologia la „Aprobat"', () => {
    expect(stepStates('rejected', false).approved).toBe('failed');
    expect(stepStates('approved', true).ticket).toBe('done');
  });
});

describe('biletul', () => {
  it('fără `status` (server vechi) cade pe `used`', () => {
    expect(passStatusOf({ used: false })).toBe('valid');
    expect(passStatusOf({ used: true })).toBe('used');
    expect(passStatusOf({ used: true, status: 'admitted' })).toBe('admitted');
  });

  it('codul scurt: ultimele 8 caractere, 4 + 4', () => {
    expect(shortTicketCode('0f3a9c1be2d84c7aa1b2c3d4e5f6a7b8')).toBe('E5F6 A7B8');
  });
});

describe('codurile de refuz', () => {
  const err = (status: number, body: unknown) => ({ response: { status, data: body } });

  it('se decide după cod, nu după status', () => {
    expect(isTicketSalesClosedError(err(409, { code: 'ticket_sales_closed' }))).toBe(true);
    expect(isTicketSalesClosedError(err(400, { code: 'ticket_sales_closed' }))).toBe(true);
    expect(isTicketSalesClosedError(err(409, { detail: 'Vânzarea s-a închis' }))).toBe(false);
    expect(isEventStartedError(err(409, { code: 'event_started' }))).toBe(true);
  });

  it('acceptă și forma cu `detail` obiect', () => {
    expect(apiErrorCode(err(409, { detail: { code: 'ticket_sales_closed' } }))).toEqual({
      status: 409,
      code: 'ticket_sales_closed',
    });
    expect(apiErrorCode(new Error('offline'))).toEqual({ status: undefined, code: undefined });
  });
});

describe('summarizeOrder — starea spusă omului', () => {
  it.each([
    [{ status: 'awaiting_payment' }, 'awaiting', 'action'],
    [{ status: 'pending_payment' }, 'awaiting', 'action'],
    [{ status: 'additional_information_required' }, 'moreInfo', 'action'],
    [{ status: 'payment_declared' }, 'review', 'review'],
    [{ status: 'payment_proof_submitted' }, 'review', 'review'],
    [{ status: 'under_review' }, 'review', 'review'],
    [{ status: 'approved', ticketCode: null }, 'generating', 'ok'],
    [{ status: 'approved', ticketCode: 'X', ticketStatus: 'valid' }, 'ready', 'ok'],
    [{ status: 'approved', ticketCode: 'X', ticketStatus: null }, 'ready', 'ok'],
    [{ status: 'approved', ticketCode: 'X', ticketStatus: 'admitted' }, 'admitted', 'ok'],
    [{ status: 'approved', ticketCode: 'X', ticketStatus: 'used' }, 'used', 'muted'],
    [{ status: 'approved', ticketCode: 'X', ticketStatus: 'expired' }, 'expired', 'muted'],
    [{ status: 'approved', ticketCode: 'X', ticketStatus: 'cancelled' }, 'ticketCancelled', 'danger'],
    [{ status: 'rejected' }, 'rejected', 'danger'],
    [{ status: 'cancelled' }, 'cancelled', 'danger'],
    [{ status: 'ceva_nou' }, 'unknown', 'review'],
  ] as const)('%o → %s (%s)', (order, key, tone) => {
    expect(summarizeOrder(order)).toEqual({ key, tone });
  });

  it('o comandă neplătită la un eveniment început nu mai are pași online', () => {
    expect(summarizeOrder({ status: 'awaiting_payment' }, true)).toEqual({ key: 'closed', tone: 'muted' });
    // Un bilet deja confirmat rămâne bun la intrare și după ora de început.
    expect(summarizeOrder({ status: 'approved', ticketCode: 'X', ticketStatus: 'valid' }, true).key).toBe('ready');
  });
});

describe('hasEventStarted', () => {
  const NOW = Date.parse('2026-10-01T20:00:00Z');
  it('compară cu ceasul dat; lipsa sau o dată nevalidă nu blochează nimic', () => {
    expect(hasEventStarted('2026-10-01T19:59:59Z', NOW)).toBe(true);
    expect(hasEventStarted('2026-10-01T20:00:01Z', NOW)).toBe(false);
    expect(hasEventStarted('mâine', NOW)).toBe(false);
    expect(hasEventStarted(null, NOW)).toBe(false);
  });
});

describe('ora pe fusul Chișinăului', () => {
  it('ora intrării se scrie pe ora evenimentului, nu pe a telefonului', () => {
    // 20:04 UTC în octombrie = 23:04 la Chișinău (EEST, UTC+3).
    expect(formatTime('2026-10-01T20:04:00Z')).toMatch(/23[:.]04/);
    // Iarna (EET, UTC+2).
    expect(formatTime('2026-12-01T20:04:00Z')).toMatch(/22[:.]04/);
  });
});
