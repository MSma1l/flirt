import {
  fetchEntitlements,
  fetchMySubscription,
  fetchPlans,
  purchase,
} from '../subscriptionApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

const RAW_PLANS = [
  {
    code: 'premium',
    title: 'Premium',
    price_eur: 9.99,
    features: ['Fără reclame', 'Vezi cine te-a plăcut'],
  },
  { code: 'free', title: 'Gratuit', price_eur: 0, features: [] },
];

describe('fetchPlans', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cere /subscriptions/plans și mapează price_eur → priceEur', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: RAW_PLANS });

    const plans = await fetchPlans();

    expect(api.get).toHaveBeenCalledWith('/subscriptions/plans');
    expect(plans).toEqual([
      {
        code: 'premium',
        title: 'Premium',
        priceEur: 9.99,
        features: ['Fără reclame', 'Vezi cine te-a plăcut'],
      },
      { code: 'free', title: 'Gratuit', priceEur: 0, features: [] },
    ]);
  });

  it('întoarce listă goală când data lipsește', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: null });
    const plans = await fetchPlans();
    expect(plans).toEqual([]);
  });
});

describe('fetchMySubscription', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cere /subscriptions/me și mapează expires_at → expiresAt', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { plan: 'premium', status: 'active', expires_at: '2026-08-01T00:00:00Z' },
    });

    const sub = await fetchMySubscription();

    expect(api.get).toHaveBeenCalledWith('/subscriptions/me');
    expect(sub).toEqual({
      plan: 'premium',
      status: 'active',
      expiresAt: '2026-08-01T00:00:00Z',
    });
  });

  it('întoarce null când nu există abonament', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: null });
    const sub = await fetchMySubscription();
    expect(sub).toBeNull();
  });
});

describe('purchase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite payload-ul {plan} și mapează răspunsul în camelCase', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { plan: 'premium', status: 'active', expires_at: '2026-08-01T00:00:00Z' },
    });

    const sub = await purchase('premium');

    expect(api.post).toHaveBeenCalledWith('/subscriptions/purchase', { plan: 'premium' });
    expect(sub).toEqual({
      plan: 'premium',
      status: 'active',
      expiresAt: '2026-08-01T00:00:00Z',
    });
  });
});

describe('fetchEntitlements', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cere /subscriptions/entitlements și mapează no_ads/ai_bot → noAds/aiBot', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { premium: true, no_ads: true, ai_bot: false },
    });

    const ent = await fetchEntitlements();

    expect(api.get).toHaveBeenCalledWith('/subscriptions/entitlements');
    expect(ent).toEqual({ premium: true, noAds: true, aiBot: false });
  });
});
