/**
 * Teste pentru serviciul de achiziții native.
 *
 * Cel mai important test din tot fișierul e „backend-ul refuză → NU finalizăm":
 * dacă ordinea se inversează vreodată, userul plătește și nu primește nimic, iar
 * dovada de plată dispare din coada magazinului. Nu ștergeți testul acela.
 */
import type { Purchase } from 'expo-iap';

import type { Subscription } from '@/features/subscription/types';

/* ------------------------------- Mock-uri ------------------------------- */

// ID-urile de produs vin din `app.json` → `extra` (ca în producție), nu din cod.
jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      apiUrl: 'http://localhost:8000/api/v1',
      iapProductIds: {
        premium: 'eu.flirt.app.premium.monthly',
        no_ads: 'eu.flirt.app.noads.monthly',
      },
    },
  },
}));

const mockInitConnection = jest.fn<Promise<boolean>, []>(async () => true);
const mockEndConnection = jest.fn(async () => true);
const mockFetchProducts = jest.fn<Promise<unknown[]>, [unknown]>(async () => []);
const mockRequestPurchase = jest.fn<Promise<unknown>, [unknown]>(async () => null);
const mockFinishTransaction = jest.fn<Promise<void>, [unknown]>(async () => undefined);
const mockGetAvailablePurchases = jest.fn<Promise<unknown[]>, []>(async () => []);
const mockRestorePurchases = jest.fn(async () => undefined);
const mockRemove = jest.fn();

// Listener-ele magazinului: `requestPurchase` NU întoarce rezultatul achiziției,
// el vine prin aceste callback-uri. Le capturăm ca să simulăm magazinul.
let mockOnPurchase: (purchase: unknown) => void = () => undefined;
let mockOnError: (error: unknown) => void = () => undefined;

jest.mock('expo-iap', () => ({
  initConnection: () => mockInitConnection(),
  endConnection: () => mockEndConnection(),
  fetchProducts: (args: unknown) => mockFetchProducts(args),
  requestPurchase: (args: unknown) => mockRequestPurchase(args),
  finishTransaction: (args: unknown) => mockFinishTransaction(args),
  getAvailablePurchases: () => mockGetAvailablePurchases(),
  restorePurchases: () => mockRestorePurchases(),
  purchaseUpdatedListener: (listener: (p: unknown) => void) => {
    mockOnPurchase = listener;
    return { remove: mockRemove };
  },
  purchaseErrorListener: (listener: (e: unknown) => void) => {
    mockOnError = listener;
    return { remove: mockRemove };
  },
}));

const mockServerPurchase = jest.fn<Promise<Subscription>, [string, string?]>();
jest.mock('@/features/subscription/subscriptionApi', () => ({
  purchase: (plan: string, receipt?: string) => mockServerPurchase(plan, receipt),
}));

import {
  IapError,
  connectStore,
  disconnectStore,
  fetchStoreCatalog,
  purchasePlan,
  restore,
  resumeUnfinishedPurchases,
} from '../iap';

/* ------------------------------- Fixtures ------------------------------- */

const PREMIUM_ID = 'eu.flirt.app.premium.monthly';
const NO_ADS_ID = 'eu.flirt.app.noads.monthly';
/** JWS-ul semnat de StoreKit 2 — dovada pe care backend-ul o validează la Apple. */
const JWS = 'eyJhbGciOiJFUzI1NiJ9.storekit2-jws.signature';

const SUBSCRIPTION: Subscription = {
  plan: 'premium',
  status: 'active',
  expiresAt: '2026-08-14T00:00:00Z',
};

const PREMIUM_PRODUCT = {
  id: PREMIUM_ID,
  title: 'Premium',
  description: 'Fără reclame, boost zilnic',
  displayPrice: '9,99 €',
  currency: 'EUR',
  platform: 'ios',
  type: 'subs',
};

function purchaseFixture(overrides: Record<string, unknown> = {}): Purchase {
  return {
    id: 'tx-1',
    productId: PREMIUM_ID,
    purchaseToken: JWS,
    purchaseState: 'purchased',
    isAutoRenewing: true,
    platform: 'ios',
    store: 'app-store',
    quantity: 1,
    transactionDate: 1_760_000_000_000,
    transactionId: 'tx-1',
    ...overrides,
  } as unknown as Purchase;
}

/** Lasă microtask-urile din `purchasePlan` să ajungă până la `requestPurchase`. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  mockInitConnection.mockResolvedValue(true);
  mockFetchProducts.mockResolvedValue([PREMIUM_PRODUCT]);
  mockRequestPurchase.mockResolvedValue(null);
  mockFinishTransaction.mockResolvedValue(undefined);
  mockGetAvailablePurchases.mockResolvedValue([]);
  mockServerPurchase.mockResolvedValue(SUBSCRIPTION);
});

afterEach(async () => {
  // Conexiunea și listener-ele sunt stare de modul — le resetăm între teste.
  await disconnectStore();
});

/* ------------------------------- Conexiune ------------------------------ */

describe('connectStore', () => {
  it('deschide conexiunea o singură dată, oricâți apelanți ar fi', async () => {
    await Promise.all([connectStore(), connectStore(), connectStore()]);
    expect(mockInitConnection).toHaveBeenCalledTimes(1);
  });

  it('raportează magazin indisponibil când conexiunea eșuează', async () => {
    mockInitConnection.mockResolvedValue(false);
    await expect(connectStore()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('permite reîncercarea după o conexiune eșuată', async () => {
    mockInitConnection.mockRejectedValueOnce(new Error('offline'));
    await expect(connectStore()).rejects.toBeInstanceOf(IapError);

    mockInitConnection.mockResolvedValue(true);
    await expect(connectStore()).resolves.toBeUndefined();
  });
});

/* -------------------------------- Produse ------------------------------- */

describe('fetchStoreCatalog', () => {
  it('cere magazinului exact ID-urile din config și întoarce prețurile REALE', async () => {
    const catalog = await fetchStoreCatalog();

    expect(mockFetchProducts).toHaveBeenCalledWith({
      skus: [PREMIUM_ID, NO_ADS_ID],
      type: 'subs',
    });
    expect(catalog.products).toEqual([
      {
        plan: 'premium',
        productId: PREMIUM_ID,
        displayPrice: '9,99 €',
        currency: 'EUR',
        title: 'Premium',
        description: 'Fără reclame, boost zilnic',
      },
    ]);
  });

  it('raportează EXPLICIT planurile lipsă din magazin (nu le ascunde)', async () => {
    const catalog = await fetchStoreCatalog();
    expect(catalog.missingPlans).toEqual(['no_ads']);
  });

  it('refuză cumpărarea unui plan pe care magazinul nu-l vinde', async () => {
    await expect(purchasePlan('no_ads')).rejects.toMatchObject({ kind: 'product-missing' });
    expect(mockRequestPurchase).not.toHaveBeenCalled();
  });

  it('refuză un plan care nu are deloc ID de produs în config', async () => {
    await expect(purchasePlan('inexistent')).rejects.toMatchObject({ kind: 'product-missing' });
    expect(mockRequestPurchase).not.toHaveBeenCalled();
  });
});

/* ------------------------------- Achiziție ------------------------------ */

describe('purchasePlan', () => {
  it('cere abonamentul de la magazin fără finalizare automată', async () => {
    const flow = purchasePlan('premium');
    await flush();

    expect(mockRequestPurchase).toHaveBeenCalledWith({
      type: 'subs',
      request: {
        apple: { sku: PREMIUM_ID, andDangerouslyFinishTransactionAutomatically: false },
        google: { skus: [PREMIUM_ID], subscriptionOffers: [] },
      },
    });

    mockOnPurchase(purchaseFixture());
    await expect(flow).resolves.toMatchObject({ status: 'active', plan: 'premium' });
  });

  it('ORDINE CRITICĂ: confirmă JWS-ul la backend ÎNAINTE de finishTransaction', async () => {
    const order: string[] = [];
    mockServerPurchase.mockImplementation(async () => {
      order.push('backend');
      return SUBSCRIPTION;
    });
    mockFinishTransaction.mockImplementation(async () => {
      order.push('finish');
    });

    const flow = purchasePlan('premium');
    await flush();
    mockOnPurchase(purchaseFixture());
    const outcome = await flow;

    expect(order).toEqual(['backend', 'finish']);
    expect(mockServerPurchase).toHaveBeenCalledWith('premium', JWS);
    expect(mockFinishTransaction).toHaveBeenCalledWith({
      purchase: expect.objectContaining({ productId: PREMIUM_ID }),
      isConsumable: false,
    });
    expect(outcome).toEqual({ status: 'active', plan: 'premium', subscription: SUBSCRIPTION });
  });

  it('BACKEND-UL REFUZĂ → finishTransaction NU se apelează (tranzacția nu se pierde)', async () => {
    mockServerPurchase.mockRejectedValue(new Error('500 Internal Server Error'));

    const flow = purchasePlan('premium');
    await flush();
    mockOnPurchase(purchaseFixture());

    await expect(flow).rejects.toMatchObject({ kind: 'not-confirmed' });
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('rețeaua cade la confirmare → tranzacția rămâne nefinalizată și e reluată apoi', async () => {
    mockServerPurchase.mockRejectedValueOnce(new Error('Network Error'));

    const flow = purchasePlan('premium');
    await flush();
    mockOnPurchase(purchaseFixture());
    await expect(flow).rejects.toMatchObject({ kind: 'not-confirmed' });
    expect(mockFinishTransaction).not.toHaveBeenCalled();

    // Magazinul o păstrează în coadă → la revenirea pe ecran o ducem la capăt.
    mockGetAvailablePurchases.mockResolvedValue([purchaseFixture()]);
    await expect(resumeUnfinishedPurchases()).resolves.toEqual(['premium']);
    expect(mockServerPurchase).toHaveBeenLastCalledWith('premium', JWS);
    expect(mockFinishTransaction).toHaveBeenCalledTimes(1);
  });

  it('anularea de către user nu trimite nimic la backend și nu finalizează nimic', async () => {
    const flow = purchasePlan('premium');
    await flush();
    mockOnError({ code: 'user-cancelled', message: 'Cancelled' });

    await expect(flow).rejects.toMatchObject({ kind: 'cancelled' });
    expect(mockServerPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('achiziție în așteptare (Ask to Buy): nu confirmă și nu finalizează', async () => {
    const flow = purchasePlan('premium');
    await flush();
    mockOnPurchase(purchaseFixture({ purchaseState: 'pending' }));

    await expect(flow).resolves.toEqual({ status: 'pending', plan: 'premium' });
    expect(mockServerPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('„already owned": recuperează achiziția existentă în loc să ceară bani din nou', async () => {
    mockGetAvailablePurchases.mockResolvedValue([purchaseFixture()]);

    const flow = purchasePlan('premium');
    await flush();
    mockOnError({ code: 'already-owned', message: 'Already owned' });

    await expect(flow).resolves.toMatchObject({ status: 'active', plan: 'premium' });
    expect(mockServerPurchase).toHaveBeenCalledWith('premium', JWS);
    expect(mockFinishTransaction).toHaveBeenCalledTimes(1);
  });

  it('„already owned" fără nimic în magazin → cere restaurarea, nu o a doua plată', async () => {
    mockGetAvailablePurchases.mockResolvedValue([]);

    const flow = purchasePlan('premium');
    await flush();
    mockOnError({ code: 'already-owned', message: 'Already owned' });

    await expect(flow).rejects.toMatchObject({ kind: 'already-owned' });
    expect(mockServerPurchase).not.toHaveBeenCalled();
  });

  it('acceptă și JWS-ul din câmpul vechi `jwsRepresentationIos`', async () => {
    const flow = purchasePlan('premium');
    await flush();
    mockOnPurchase(purchaseFixture({ purchaseToken: null, jwsRepresentationIos: JWS }));

    await expect(flow).resolves.toMatchObject({ status: 'active' });
    expect(mockServerPurchase).toHaveBeenCalledWith('premium', JWS);
  });

  it('fără dovadă de plată nu confirmă și nu finalizează', async () => {
    const flow = purchasePlan('premium');
    await flush();
    mockOnPurchase(purchaseFixture({ purchaseToken: null }));

    await expect(flow).rejects.toMatchObject({ kind: 'not-confirmed' });
    expect(mockServerPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('finalizarea eșuată nu-i ia userului abonamentul deja activat de backend', async () => {
    mockFinishTransaction.mockRejectedValue(new Error('finish failed'));

    const flow = purchasePlan('premium');
    await flush();
    mockOnPurchase(purchaseFixture());

    await expect(flow).resolves.toMatchObject({ status: 'active', subscription: SUBSCRIPTION });
  });
});

/* ------------------------------ Restaurare ------------------------------ */

describe('restore', () => {
  it('sincronizează cu magazinul, confirmă la backend și finalizează', async () => {
    mockGetAvailablePurchases.mockResolvedValue([purchaseFixture()]);

    const result = await restore();

    expect(mockRestorePurchases).toHaveBeenCalled();
    expect(mockServerPurchase).toHaveBeenCalledWith('premium', JWS);
    expect(mockFinishTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ restoredPlans: ['premium'] });
  });

  it('nu inventează nimic când contul nu are achiziții', async () => {
    await expect(restore()).resolves.toEqual({ restoredPlans: [] });
    expect(mockServerPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('la restaurare, o tranzacție neconfirmată de backend NU se finalizează', async () => {
    mockGetAvailablePurchases.mockResolvedValue([purchaseFixture()]);
    mockServerPurchase.mockRejectedValue(new Error('503'));

    await expect(restore()).resolves.toEqual({ restoredPlans: [] });
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('ignoră produsele care nu aparțin catalogului nostru', async () => {
    mockGetAvailablePurchases.mockResolvedValue([
      purchaseFixture({ productId: 'com.altcineva.produs' }),
    ]);

    await expect(restore()).resolves.toEqual({ restoredPlans: [] });
    expect(mockServerPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });
});

describe('resumeUnfinishedPurchases', () => {
  it('sare peste tranzacțiile încă în așteptare (banii nu s-au luat)', async () => {
    mockGetAvailablePurchases.mockResolvedValue([purchaseFixture({ purchaseState: 'pending' })]);

    await expect(resumeUnfinishedPurchases()).resolves.toEqual([]);
    expect(mockServerPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });
});
