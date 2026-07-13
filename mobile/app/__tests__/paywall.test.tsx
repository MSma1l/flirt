import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import PaywallScreen from '../paywall';
import { config } from '@/config';
import type { Entitlements, Plan, Subscription } from '@/features/subscription/types';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Linkurile legale se deschid în browser — spionăm, nu deschidem nimic.
const mockOpenURL = jest
  .spyOn(Linking, 'openURL')
  .mockImplementation(() => Promise.resolve(true));

// Mock la subscriptionApi: planurile + abonamentul curent + spionăm purchase/restore.
const mockFetchPlans = jest.fn<Promise<Plan[]>, []>(() => Promise.resolve([]));
const mockFetchMe = jest.fn<Promise<Subscription | null>, []>(() => Promise.resolve(null));
const mockPurchase = jest.fn((_plan: string) =>
  Promise.resolve({ plan: 'premium', status: 'active', expiresAt: '2026-08-01' }),
);
const mockFetchEntitlements = jest.fn<Promise<Entitlements>, []>(() =>
  Promise.resolve({ premium: true, noAds: true, aiBot: true }),
);
jest.mock('@/features/subscription/subscriptionApi', () => ({
  fetchPlans: () => mockFetchPlans(),
  fetchMySubscription: () => mockFetchMe(),
  purchase: (plan: string) => mockPurchase(plan),
  fetchEntitlements: () => mockFetchEntitlements(),
}));

const plans: Plan[] = [
  { code: 'free', title: 'Gratuit', priceEur: 0, features: ['Bază'] },
  { code: 'premium', title: 'Premium', priceEur: 9.99, features: ['Fără reclame', 'Boost'] },
];

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
    mockFetchPlans.mockReset();
    mockFetchMe.mockReset();
    mockPurchase.mockReset();
    mockFetchMe.mockResolvedValue(null);
    mockPurchase.mockResolvedValue({ plan: 'premium', status: 'active', expiresAt: '2026-08-01' });
    mockFetchEntitlements.mockClear();
    mockFetchEntitlements.mockResolvedValue({ premium: true, noAds: true, aiBot: true });
    mockOpenURL.mockClear();
  });

  it('randează planurile cu titlu, preț și features', async () => {
    mockFetchPlans.mockResolvedValue(plans);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Gratuit'));
    expect(getByText('Premium')).toBeTruthy();
    expect(getByText('9.99 € / lună')).toBeTruthy();
    expect(getByText('Fără reclame')).toBeTruthy();
  });

  /* --- Conformitate App Store (Guidelines 2.1 / 3.1.2) --- */

  it('NU menționează niciun provider de plăți sau text de dezvoltare', async () => {
    mockFetchPlans.mockResolvedValue(plans);
    const { getByText, queryByText } = renderScreen();

    await waitFor(() => getByText('Gratuit'));
    expect(queryByText(/stripe/i)).toBeNull();
    expect(queryByText(/provider/i)).toBeNull();
    expect(queryByText(/stub/i)).toBeNull();
    expect(queryByText(/curând/i)).toBeNull();
  });

  it('are buton de restaurare a achizițiilor', async () => {
    mockFetchPlans.mockResolvedValue(plans);
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-restore'));
    fireEvent.press(getByTestId('paywall-restore'));

    await waitFor(() => expect(mockFetchEntitlements).toHaveBeenCalled());
    await waitFor(() => getByTestId('paywall-restore-done'));
  });

  it('afișează linkurile către Termeni și Politica de confidențialitate', async () => {
    mockFetchPlans.mockResolvedValue(plans);
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('paywall-terms-link'));

    fireEvent.press(getByTestId('paywall-terms-link'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.termsUrl);

    fireEvent.press(getByTestId('paywall-privacy-link'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.privacyUrl);
  });

  it('marchează planul curent cu badge „Activ"', async () => {
    mockFetchPlans.mockResolvedValue(plans);
    mockFetchMe.mockResolvedValue({ plan: 'premium', status: 'active', expiresAt: '2026-08-01' });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('plan-premium-active'));
    expect(getByTestId('plan-premium-active')).toBeTruthy();
  });

  it('„Alege" apelează purchase și arată mesajul de succes', async () => {
    mockFetchPlans.mockResolvedValue(plans);
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('plan-premium-choose'));
    fireEvent.press(getByTestId('plan-premium-choose'));

    await waitFor(() => expect(mockPurchase).toHaveBeenCalledWith('premium'));
    await waitFor(() => getByTestId('paywall-success'));
    expect(getByText('Abonament activat 🎉')).toBeTruthy();
  });
});
