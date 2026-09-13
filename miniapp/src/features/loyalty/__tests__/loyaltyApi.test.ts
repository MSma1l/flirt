/**
 * Maparea răspunsurilor `/loyalty/*` (snake_case → camelCase).
 *
 * DE CE are test propriu: spre deosebire de restul modulelor din Mini App,
 * acesta NU re-exportă funcții deja testate din aplicația Expo — ruta e nouă și
 * maparea e scrisă de mână. Un câmp scris greșit aici nu cade la compilare (JSON
 * de la server e `any` în practică), ci ajunge `undefined` pe ecran.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const { api } = await import('@/api/client');
const { fetchLoyaltyStatus, fetchTicketQuote, redeemInvite } = await import('../loyaltyApi');

const TIER = { code: 'gold', name: 'Aur', min_stamps: 12, discount_percent: 20 };

describe('fetchLoyaltyStatus', () => {
  it('cere `/loyalty/me` și mapează toate câmpurile', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        stamps: 13,
        tier: TIER,
        discount_percent: 20,
        next_tier: null,
        stamps_to_next_tier: null,
        tiers: [TIER],
        max_total_discount_percent: 30,
      },
    });

    const status = await fetchLoyaltyStatus();

    expect(api.get).toHaveBeenCalledWith('/loyalty/me');
    expect(status).toEqual({
      stamps: 13,
      tier: { code: 'gold', name: 'Aur', minStamps: 12, discountPercent: 20 },
      discountPercent: 20,
      nextTier: null,
      stampsToNextTier: null,
      tiers: [{ code: 'gold', name: 'Aur', minStamps: 12, discountPercent: 20 }],
      maxTotalDiscountPercent: 30,
    });
  });

  it('un backend fără programul configurat dă o scară goală, nu `undefined`', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { stamps: 0, discount_percent: 0, max_total_discount_percent: 0 },
    });

    const status = await fetchLoyaltyStatus();

    expect(status.tiers).toEqual([]);
    expect(status.tier).toBeNull();
    expect(status.nextTier).toBeNull();
    expect(status.stampsToNextTier).toBeNull();
  });
});

describe('fetchTicketQuote', () => {
  it('cere cotația evenimentului și mapează defalcarea', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        event_id: 'e1',
        base_price: 250,
        currency: 'lei',
        loyalty_percent: 20,
        promo_percent: 10,
        invite_percent: 0,
        applied_percent: 20,
        applied_source: 'loyalty',
        capped: false,
        discount_amount: 50,
        final_price: 200,
        tier: TIER,
      },
    });

    const quote = await fetchTicketQuote('e1');

    expect(api.get).toHaveBeenCalledWith('/loyalty/events/e1/ticket-quote');
    expect(quote.finalPrice).toBe(200);
    expect(quote.basePrice).toBe(250);
    expect(quote.appliedSource).toBe('loyalty');
    expect(quote.tier?.minStamps).toBe(12);
  });

  it('o sursă necunoscută (adăugată pe server mai târziu) devine „none", nu un ecran stricat', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        event_id: 'e1',
        base_price: 250,
        currency: 'lei',
        loyalty_percent: 0,
        promo_percent: 0,
        invite_percent: 0,
        applied_percent: 0,
        applied_source: 'birthday',
        capped: false,
        discount_amount: 0,
        final_price: 250,
        tier: null,
      },
    });

    expect((await fetchTicketQuote('e1')).appliedSource).toBe('none');
  });
});

describe('redeemInvite', () => {
  it('trimite DOAR codul, la ruta de folosire', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        invite_id: 'i1',
        event_id: 'e1',
        event_title: 'Flirt Party',
        event_starts_at: '2026-05-01T20:00:00Z',
        discount_percent: 30,
        redeemed_at: '2026-04-01T10:00:00Z',
        consumed_new_use: true,
      },
    });

    const redemption = await redeemInvite('ABCD2345');

    // Niciun preț, niciun procent, niciun id de treaptă: contractul serverului
    // spune că singurul lucru pe care îl trimite clientul e codul.
    expect(api.post).toHaveBeenCalledWith('/loyalty/invites/redeem', { code: 'ABCD2345' });
    expect(redemption.consumedNewUse).toBe(true);
    expect(redemption.eventTitle).toBe('Flirt Party');
    expect(redemption.discountPercent).toBe(30);
  });
});
