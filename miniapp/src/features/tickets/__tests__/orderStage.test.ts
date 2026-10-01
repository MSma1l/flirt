/** Etapele comenzii, starea biletului și citirea codurilor de refuz. */
import { describe, expect, it } from 'vitest';

import {
  apiErrorCode,
  isEventStartedError,
  isTicketSalesClosedError,
  orderStage,
  passStatusOf,
  shortTicketCode,
  stepStates,
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
