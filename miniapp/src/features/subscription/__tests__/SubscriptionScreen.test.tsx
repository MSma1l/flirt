/**
 * Ecranul de abonamente: catalogul se vede, planul activ e marcat, iar plata
 * NU se poate face din Telegram — butonul e mort și mesajul o spune pe față.
 *
 * Stratul de rețea e izolat la nivelul modulului propriu `subscriptionApi`
 * (care re-exportă funcțiile reutilizate din aplicația Expo), ca testele să
 * verifice DECIZIILE ecranului, nu axios.
 */
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entitlements, Plan, Subscription } from '@mobile/features/subscription/types';

import { renderWithProviders } from '@/test/harness';

import { SubscriptionScreen } from '../SubscriptionScreen';

vi.mock('../subscriptionApi', () => ({
  fetchPlans: vi.fn(),
  fetchMySubscription: vi.fn(),
  fetchEntitlements: vi.fn(),
}));

const { fetchEntitlements, fetchMySubscription, fetchPlans } = await import('../subscriptionApi');

const PLANS: Plan[] = [
  // Plan din catalogul i18n: titlul și beneficiile vin din traduceri.
  { code: 'premium', title: 'Premium (de la server)', priceEur: 9.99, features: ['Beneficiu server'] },
  // Plan NECUNOSCUT clientului (adăugat pe server): își păstrează textele serverului.
  { code: 'mystery', title: 'Plan misterios', priceEur: 3, features: ['Doar de la server'] },
];

const SUBSCRIPTION: Subscription = {
  plan: 'premium',
  status: 'active',
  expiresAt: '2030-03-15T10:00:00Z',
  entriesTotal: null,
  entriesRemaining: null,
};

const ENTITLEMENTS: Entitlements = {
  premium: true,
  noAds: true,
  aiBot: false,
  eventDiscount: false,
};

beforeEach(() => {
  vi.mocked(fetchPlans).mockResolvedValue(PLANS);
  vi.mocked(fetchMySubscription).mockResolvedValue(SUBSCRIPTION);
  vi.mocked(fetchEntitlements).mockResolvedValue(ENTITLEMENTS);
});

describe('stări de încărcare și date lipsă', () => {
  it('arată un indicator cât timp catalogul se încarcă', () => {
    vi.mocked(fetchPlans).mockReturnValue(new Promise<Plan[]>(() => {}));
    renderWithProviders(<SubscriptionScreen />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-card-premium')).not.toBeInTheDocument();
  });

  it('catalogul gol are un text explicativ, nu un ecran alb', async () => {
    vi.mocked(fetchPlans).mockResolvedValue([]);
    renderWithProviders(<SubscriptionScreen />);

    expect(await screen.findByTestId('subscription-empty')).toHaveTextContent(
      'Nu există planuri de abonament disponibile momentan.',
    );
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchPlans).mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<SubscriptionScreen />);

    expect(await screen.findByTestId('subscription-error')).toHaveTextContent(
      'Nu am putut încărca abonamentele.',
    );

    vi.mocked(fetchPlans).mockResolvedValue(PLANS);
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByTestId('plan-card-premium')).toBeInTheDocument();
  });
});

describe('catalogul de planuri', () => {
  it('arată titlul din traduceri, prețul și beneficiile', async () => {
    renderWithProviders(<SubscriptionScreen />);

    const card = await screen.findByTestId('plan-card-premium');
    // Titlul vine din catalogul i18n, nu din răspunsul serverului.
    expect(card).toHaveTextContent('Premium');
    expect(card).not.toHaveTextContent('Premium (de la server)');
    expect(card).toHaveTextContent('9.99 € / lună');
    expect(card).toHaveTextContent('Swipe nelimitat');
  });

  it('un plan necunoscut clientului își păstrează textele serverului', async () => {
    renderWithProviders(<SubscriptionScreen />);

    const card = await screen.findByTestId('plan-card-mystery');
    expect(card).toHaveTextContent('Plan misterios');
    expect(card).toHaveTextContent('Doar de la server');
    expect(card).toHaveTextContent('3 € / lună');
  });

  it('planul activ e marcat, iar abonamentul curent arată starea și expirarea', async () => {
    renderWithProviders(<SubscriptionScreen />);

    expect(await screen.findByTestId('plan-card-premium-active')).toHaveTextContent('Activ');
    expect(screen.queryByTestId('plan-card-mystery-active')).not.toBeInTheDocument();

    const current = screen.getByTestId('subscription-current');
    expect(current).toHaveTextContent('Stare: Activ');
    expect(current).toHaveTextContent('2030');
    // Drepturile deblocate sunt cele întoarse de server, nu toate cele posibile.
    expect(current).toHaveTextContent('Fără reclamă');
    expect(current).not.toHaveTextContent('AI-bot în chat');
  });

  it('cardul de reduceri își arată intrările rămase', async () => {
    vi.mocked(fetchMySubscription).mockResolvedValue({
      plan: 'card_5',
      status: 'active',
      expiresAt: '2030-03-15T10:00:00Z',
      entriesTotal: 5,
      entriesRemaining: 2,
    });
    renderWithProviders(<SubscriptionScreen />);

    expect(await screen.findByTestId('subscription-entries')).toHaveTextContent(
      // Contorul reutilizează cheia cu plural din Flirt Passport
      // (`profile:passport.discountCard.entriesLeft`), deci fraza e a ei.
      '2 intrări rămase din 5',
    );
  });
});

describe('plata nu se face din Telegram', () => {
  it('butonul de cumpărare e dezactivat pe fiecare plan, cu mesajul de indisponibilitate vizibil', async () => {
    renderWithProviders(<SubscriptionScreen />);

    expect(await screen.findByTestId('purchase-unavailable')).toHaveTextContent(
      'Plata nu este disponibilă în Telegram deocamdată.',
    );

    expect(screen.getByTestId('plan-card-mystery-buy')).toBeDisabled();
    expect(screen.getByTestId('plan-card-mystery-buy')).toHaveTextContent(
      'Disponibil în aplicația mobilă',
    );
    // Planul activ nu se „cumpără" oricum: butonul lui spune asta, tot inert.
    expect(screen.getByTestId('plan-card-premium-buy')).toBeDisabled();
    expect(screen.getByTestId('plan-card-premium-buy')).toHaveTextContent('Plan activ');
  });

  it('niciun buton al ecranului nu poate declanșa o achiziție', async () => {
    renderWithProviders(<SubscriptionScreen />);
    await screen.findByTestId('plan-card-premium');

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});

describe('date parțiale de la server', () => {
  it('lipsa unui abonament (`null`) nu strică ecranul', async () => {
    vi.mocked(fetchMySubscription).mockResolvedValue(null);
    renderWithProviders(<SubscriptionScreen />);

    expect(await screen.findByTestId('subscription-none')).toHaveTextContent(
      'Nu ai un abonament activ.',
    );
    expect(screen.queryByTestId('subscription-current')).not.toBeInTheDocument();
    // Planurile rămân vizibile: ele nu depind de abonament.
    expect(screen.getByTestId('plan-card-premium')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-card-premium-active')).not.toBeInTheDocument();
  });

  it('căderea drepturilor (`/entitlements`) nu ascunde catalogul', async () => {
    vi.mocked(fetchEntitlements).mockRejectedValue(new Error('offline'));
    renderWithProviders(<SubscriptionScreen />);

    expect(await screen.findByTestId('plan-card-premium')).toBeInTheDocument();
    expect(screen.getByTestId('subscription-current')).toHaveTextContent('Stare: Activ');
  });
});
