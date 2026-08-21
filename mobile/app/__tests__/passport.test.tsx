import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import PassportScreen from '../passport';
import i18n from '@/i18n';
import { ThemeProvider } from '@theme/index';
import type { PassportStamp } from '@/features/events/types';
import type { Subscription } from '@/features/subscription/types';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la eventsApi: grid de ștampile controlat.
const mockFetchPassport = jest.fn<Promise<PassportStamp[]>, []>(() => Promise.resolve([]));
jest.mock('@/features/events/eventsApi', () => ({
  fetchPassport: () => mockFetchPassport(),
}));

// Mock la subscriptionApi: abonamentul curent (pentru contorul „Card reduceri").
const mockFetchMe = jest.fn<Promise<Subscription | null>, []>(() => Promise.resolve(null));
jest.mock('@/features/subscription/subscriptionApi', () => ({
  fetchMySubscription: () => mockFetchMe(),
}));

const stamps: PassportStamp[] = [
  { eventId: 'e1', eventTitle: 'Flirt Party', city: 'Chișinău', stampedAt: '2026-07-01T20:00:00Z' },
  { eventId: 'e2', eventTitle: 'Concert', city: 'Bălți', stampedAt: '2026-07-05T19:00:00Z' },
];

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PassportScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('PassportScreen', () => {
  beforeEach(() => {
    mockFetchPassport.mockReset();
    mockFetchMe.mockReset();
    mockFetchMe.mockResolvedValue(null);
  });

  it('randează gridul de ștampile', async () => {
    mockFetchPassport.mockResolvedValue(stamps);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Flirt Party'));
    expect(getByText('Concert')).toBeTruthy();
  });

  it('afișează starea goală', async () => {
    mockFetchPassport.mockResolvedValue([]);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Încă nu ai ștampile — participă la un eveniment!'));
  });

  it('afișează contorul de intrări când userul are un card de reduceri', async () => {
    mockFetchPassport.mockResolvedValue([]);
    mockFetchMe.mockResolvedValue({
      plan: 'card_5',
      status: 'active',
      expiresAt: '2026-08-01',
      entriesTotal: 5,
      entriesRemaining: 3,
    });
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('passport-discount-card'));
    // Fraza s-a reformulat la migrare: numarul RAMAS e subiectul, ca forma de
    // plural sa poata fi aleasa de i18next (vezi blocul `i18n` de mai jos).
    expect(getByText('3 intrări rămase din 5')).toBeTruthy();
  });

  it('nu afișează contorul când userul nu are card de reduceri', async () => {
    mockFetchPassport.mockResolvedValue(stamps);
    mockFetchMe.mockResolvedValue({
      plan: 'premium',
      status: 'active',
      expiresAt: '2026-08-01',
      entriesTotal: null,
      entriesRemaining: null,
    });
    const { getByText, queryByTestId } = renderScreen();

    await waitFor(() => getByText('Flirt Party'));
    expect(queryByTestId('passport-discount-card')).toBeNull();
  });

  describe('i18n', () => {
    afterEach(async () => {
      await i18n.changeLanguage('ro');
    });

    it('starea goală și eroarea urmează limba activă', async () => {
      mockFetchPassport.mockResolvedValue([]);
      await i18n.changeLanguage('ru');
      const { getByText } = renderScreen();

      await waitFor(() => getByText('У вас пока нет штампов — сходите на мероприятие!'));
    });

    it('numele produsului NU se traduce', async () => {
      mockFetchPassport.mockResolvedValue([]);
      await i18n.changeLanguage('en');
      const { getByText } = renderScreen();

      // „Flirt Passport" e nume de produs, ca „FLIRT" sau „No Regrets".
      await waitFor(() => expect(getByText('Flirt Passport')).toBeTruthy());
    });

    /**
     * Contorul de intrări e singurul loc din ecran cu plural: româna are trei
     * forme (1 intrare / 3 intrări / 21 DE intrări), rusa patru. Îl verificăm pe
     * cifre care cad în categorii diferite, nu doar pe una.
     */
    it('contorul de intrări folosește forma de plural corectă', async () => {
      mockFetchPassport.mockResolvedValue([]);

      /** Randează ecranul cu un card de N intrări și așteaptă textul contorului. */
      const expectCounter = async (remaining: number, total: number, text: string) => {
        mockFetchMe.mockResolvedValue({
          plan: 'card_5',
          status: 'active',
          expiresAt: '2026-08-01',
          entriesTotal: total,
          entriesRemaining: remaining,
        });
        const { getByText } = renderScreen();
        await waitFor(() => expect(getByText(text)).toBeTruthy());
      };

      await expectCounter(1, 5, '1 intrare rămasă din 5');
      await expectCounter(3, 5, '3 intrări rămase din 5');

      await i18n.changeLanguage('ru');
      await expectCounter(1, 5, 'Остался 1 вход из 5');
      await expectCounter(3, 5, 'Осталось 3 входа из 5');
      await expectCounter(7, 10, 'Осталось 7 входов из 10');
    });

    it('eticheta de accesibilitate a cardului urmează limba activă', async () => {
      mockFetchPassport.mockResolvedValue([]);
      mockFetchMe.mockResolvedValue({
        plan: 'card_5',
        status: 'active',
        expiresAt: '2026-08-01',
        entriesTotal: 5,
        entriesRemaining: 3,
      });
      await i18n.changeLanguage('en');
      const { getByLabelText } = renderScreen();

      await waitFor(() =>
        expect(getByLabelText('Discount card: 3 entries left of 5')).toBeTruthy(),
      );
    });
  });
});
