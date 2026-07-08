import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import PaywallScreen from '../paywall';
import type { Plan, Subscription } from '@/features/subscription/types';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Mock la subscriptionApi: planurile + abonamentul curent + spionăm purchase.
const mockFetchPlans = jest.fn<Promise<Plan[]>, []>(() => Promise.resolve([]));
const mockFetchMe = jest.fn<Promise<Subscription | null>, []>(() => Promise.resolve(null));
const mockPurchase = jest.fn((_plan: string) =>
  Promise.resolve({ plan: 'premium', status: 'active', expiresAt: '2026-08-01' }),
);
jest.mock('@/features/subscription/subscriptionApi', () => ({
  fetchPlans: () => mockFetchPlans(),
  fetchMySubscription: () => mockFetchMe(),
  purchase: (plan: string) => mockPurchase(plan),
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
  });

  it('randează planurile cu titlu, preț și features', async () => {
    mockFetchPlans.mockResolvedValue(plans);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Gratuit'));
    expect(getByText('Premium')).toBeTruthy();
    expect(getByText('9.99 € / lună')).toBeTruthy();
    expect(getByText('Fără reclame')).toBeTruthy();
    expect(
      getByText('Plata reală se activează la conectarea providerului (Stripe/App Store).'),
    ).toBeTruthy();
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
