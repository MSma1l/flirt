import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import PaywallScreen from '../paywall';
import { config } from '@/config';
import { IapError } from '@/features/billing/iap';
import type { PurchaseOutcome, RestoreResult, StoreCatalog } from '@/features/billing/iap';
import type { Entitlements, Plan, Subscription } from '@/features/subscription/types';
import { ThemeProvider } from '@theme/index';

// ID-urile de produs vin din `app.json` → `extra`, la fel ca în producție.
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

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Linkurile legale se deschid în browser — spionăm, nu deschidem nimic.
const mockOpenURL = jest
  .spyOn(Linking, 'openURL')
  .mockImplementation(() => Promise.resolve(true));

// Magazinul (StoreKit) e mock-uit la nivelul serviciului de billing: ordinea
// confirmare-backend → finishTransaction e testată în `billing/__tests__/iap.test.ts`.
const mockFetchCatalog = jest.fn<Promise<StoreCatalog>, []>();
const mockPurchasePlan = jest.fn<Promise<PurchaseOutcome>, [string]>();
const mockRestore = jest.fn<Promise<RestoreResult>, []>();
const mockResume = jest.fn<Promise<string[]>, []>();

jest.mock('@/features/billing/iap', () => {
  class MockIapError extends Error {
    readonly kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.name = 'IapError';
      this.kind = kind;
    }
  }
  return {
    IapError: MockIapError,
    fetchStoreCatalog: () => mockFetchCatalog(),
    purchasePlan: (plan: string) => mockPurchasePlan(plan),
    restore: () => mockRestore(),
    resumeUnfinishedPurchases: () => mockResume(),
  };
});

// Backend: catalogul de planuri + abonamentul curent (prețurile de plată vin din magazin).
const mockFetchPlans = jest.fn<Promise<Plan[]>, []>(() => Promise.resolve([]));
const mockFetchMe = jest.fn<Promise<Subscription | null>, []>(() => Promise.resolve(null));
const mockPurchase = jest.fn((_plan: string) =>
  Promise.resolve({ plan: 'free', status: 'active', expiresAt: '2026-08-01' }),
);
const mockFetchEntitlements = jest.fn<Promise<Entitlements>, []>(() =>
  Promise.resolve({ premium: true, noAds: true, aiBot: true, eventDiscount: false }),
);
jest.mock('@/features/subscription/subscriptionApi', () => ({
  fetchPlans: () => mockFetchPlans(),
  fetchMySubscription: () => mockFetchMe(),
  purchase: (plan: string) => mockPurchase(plan),
  fetchEntitlements: () => mockFetchEntitlements(),
}));

const SUBSCRIPTION: Subscription = {
  plan: 'premium',
  status: 'active',
  expiresAt: '2026-08-01',
  entriesTotal: null,
  entriesRemaining: null,
};

const plans: Plan[] = [
  { code: 'free', title: 'Gratuit', priceEur: 0, features: ['Bază'] },
  { code: 'premium', title: 'Premium', priceEur: 9.99, features: ['Fără reclame', 'Boost'] },
];

/** Catalogul magazinului: prețul REAL, localizat (Apple îl cere pe acesta afișat). */
const catalog: StoreCatalog = {
  products: [
    {
      plan: 'premium',
      productId: 'eu.flirt.app.premium.monthly',
      displayPrice: '9,99 €',
      currency: 'EUR',
      title: 'Premium',
      description: 'Fără reclame',
    },
  ],
  missingPlans: [],
};

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PaywallScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('PaywallScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchPlans.mockResolvedValue(plans);
    mockFetchMe.mockResolvedValue(null);
    mockPurchase.mockResolvedValue({ plan: 'free', status: 'active', expiresAt: '2026-08-01' });
    mockFetchEntitlements.mockResolvedValue({
      premium: true,
      noAds: true,
      aiBot: true,
      eventDiscount: false,
    });
    mockFetchCatalog.mockResolvedValue(catalog);
    mockPurchasePlan.mockResolvedValue({
      status: 'active',
      plan: 'premium',
      subscription: SUBSCRIPTION,
    });
    mockRestore.mockResolvedValue({ restoredPlans: [] });
    mockResume.mockResolvedValue([]);
  });

  it('afișează PREȚUL DIN MAGAZIN, nu pe cel din catalogul backend', async () => {
    const { getByText, getByTestId, queryByText } = renderScreen();

    await waitFor(() => getByText('Premium'));
    expect(getByTestId('plan-premium-price')).toHaveTextContent('9,99 € / lună');
    // Prețul din backend (9.99 € cu punct) NU trebuie să apară pe cardul plătit.
    expect(queryByText('9.99 € / lună')).toBeNull();
    expect(getByText('Fără reclame')).toBeTruthy();
  });

  it('reia tranzacțiile rămase neconfirmate la deschiderea ecranului', async () => {
    renderScreen();
    await waitFor(() => expect(mockResume).toHaveBeenCalled());
  });

  /* --- Conformitate App Store (Guidelines 2.1 / 3.1.1 / 3.1.2) --- */

  it('NU menționează niciun provider de plăți sau text de dezvoltare', async () => {
    const { getByText, queryByText } = renderScreen();

    await waitFor(() => getByText('Gratuit'));
    expect(queryByText(/stripe/i)).toBeNull();
    expect(queryByText(/provider/i)).toBeNull();
    expect(queryByText(/stub/i)).toBeNull();
    expect(queryByText(/curând/i)).toBeNull();
  });

  it('afișează linkurile către Termeni și Politica de confidențialitate', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-terms-link'));

    fireEvent.press(getByTestId('paywall-terms-link'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.termsUrl);

    fireEvent.press(getByTestId('paywall-privacy-link'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.privacyUrl);
  });

  it('marchează planul curent cu badge „Activ"', async () => {
    mockFetchMe.mockResolvedValue(SUBSCRIPTION);
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('plan-premium-active'));
  });

  /* ------------------------------ Achiziție ------------------------------ */

  it('„Alege" pornește achiziția nativă și confirmă activarea', async () => {
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('plan-premium-choose'));
    fireEvent.press(getByTestId('plan-premium-choose'));

    await waitFor(() => expect(mockPurchasePlan).toHaveBeenCalledWith('premium'));
    await waitFor(() => getByTestId('paywall-success'));
    expect(getByText('Abonament activat 🎉')).toBeTruthy();
  });

  it('planul gratuit nu trece prin magazin — se activează direct la backend', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('plan-free-choose'));
    fireEvent.press(getByTestId('plan-free-choose'));

    await waitFor(() => expect(mockPurchase).toHaveBeenCalledWith('free'));
    expect(mockPurchasePlan).not.toHaveBeenCalled();
  });

  it('backend-ul nu confirmă → mesaj care spune clar că userul nu va fi taxat din nou', async () => {
    mockPurchasePlan.mockRejectedValue(
      new IapError(
        'not-confirmed',
        'Plata a fost înregistrată de magazin, dar nu am putut activa abonamentul acum. ' +
          'Nu vei fi taxat din nou — reluăm activarea automat când revii în aplicație.',
      ),
    );
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('plan-premium-choose'));
    fireEvent.press(getByTestId('plan-premium-choose'));

    await waitFor(() => getByTestId('paywall-error'));
    expect(getByTestId('paywall-error')).toHaveTextContent(/nu vei fi taxat din nou/i);
    expect(queryByTestId('paywall-success')).toBeNull();
  });

  it('anularea de către user NU afișează eroare (nu e o defecțiune)', async () => {
    mockPurchasePlan.mockRejectedValue(new IapError('cancelled', 'Ai anulat achiziția.'));
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('plan-premium-choose'));
    fireEvent.press(getByTestId('plan-premium-choose'));

    await waitFor(() => expect(mockPurchasePlan).toHaveBeenCalled());
    await waitFor(() => expect(queryByTestId('paywall-success')).toBeNull());
    expect(queryByTestId('paywall-error')).toBeNull();
  });

  it('achiziția în așteptare e anunțată, nu tratată ca eșec', async () => {
    mockPurchasePlan.mockResolvedValue({ status: 'pending', plan: 'premium' });
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('plan-premium-choose'));
    fireEvent.press(getByTestId('plan-premium-choose'));

    await waitFor(() => getByTestId('paywall-pending'));
    expect(queryByTestId('paywall-error')).toBeNull();
  });

  /* --------------------- Produse lipsă / magazin mut --------------------- */

  it('plan lipsă din magazin: îl marchează indisponibil și nu-l lasă cumpărat', async () => {
    mockFetchCatalog.mockResolvedValue({ products: [], missingPlans: ['premium'] });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-store-warning'));
    expect(getByTestId('plan-premium-unavailable')).toBeTruthy();

    fireEvent.press(getByTestId('plan-premium-choose'));
    expect(mockPurchasePlan).not.toHaveBeenCalled();
  });

  it('magazin inaccesibil: ecranul o spune explicit, nu rămâne mut', async () => {
    mockFetchCatalog.mockRejectedValue(new IapError('unavailable', 'Magazinul nu e disponibil.'));
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-store-warning'));
    expect(getByTestId('plan-premium-unavailable')).toBeTruthy();

    fireEvent.press(getByTestId('plan-premium-choose'));
    expect(mockPurchasePlan).not.toHaveBeenCalled();
  });

  /* ------------------------------ Restaurare ----------------------------- */

  it('restaurează achizițiile prin magazin (obligatoriu — Guideline 3.1.2)', async () => {
    mockRestore.mockResolvedValue({ restoredPlans: ['premium'] });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-restore'));
    fireEvent.press(getByTestId('paywall-restore'));

    await waitFor(() => expect(mockRestore).toHaveBeenCalled());
    await waitFor(() => getByTestId('paywall-restore-done'));
  });

  it('spune cinstit când nu există nimic de restaurat', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-restore'));
    fireEvent.press(getByTestId('paywall-restore'));

    await waitFor(() => getByTestId('paywall-restore-empty'));
  });

  it('afișează eroarea de restaurare venită de la magazin', async () => {
    mockRestore.mockRejectedValue(new IapError('unavailable', 'Magazinul nu e disponibil.'));
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-restore'));
    fireEvent.press(getByTestId('paywall-restore'));

    await waitFor(() => getByTestId('paywall-restore-error'));
    expect(getByTestId('paywall-restore-error')).toHaveTextContent('Magazinul nu e disponibil.');
  });
});
