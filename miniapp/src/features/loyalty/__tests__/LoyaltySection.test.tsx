/**
 * Treapta, reducerea ei și progresul spre următoarea — inima programului de
 * fidelitate în Mini App.
 *
 * Rețeaua e mockată la nivelul modulului `loyaltyApi`: testăm ce DECIDE ecranul
 * (ce arată, ce ascunde, ce nu desenează deloc), nu axios.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/harness';

import type { LoyaltyStatus } from '../loyaltyApi';
import { LoyaltyProgress, progressPercent } from '../LoyaltyProgress';
import { LoyaltySection } from '../LoyaltySection';

vi.mock('../loyaltyApi', () => ({
  fetchLoyaltyStatus: vi.fn(),
  fetchTicketQuote: vi.fn(),
  redeemInvite: vi.fn(),
}));

const { fetchLoyaltyStatus } = await import('../loyaltyApi');

const BRONZE = { code: 'bronze', name: 'Bronz', minStamps: 3, discountPercent: 5 };
const SILVER = { code: 'silver', name: 'Argint', minStamps: 6, discountPercent: 10 };
const GOLD = { code: 'gold', name: 'Aur', minStamps: 12, discountPercent: 20 };
const TIERS = [BRONZE, SILVER, GOLD];

/** Un om cu 4 ștampile: e pe Bronz, îi mai trebuie 2 până la Argint. */
const ON_THE_WAY: LoyaltyStatus = {
  stamps: 4,
  tier: BRONZE,
  discountPercent: 5,
  nextTier: SILVER,
  stampsToNextTier: 2,
  tiers: TIERS,
  maxTotalDiscountPercent: 30,
};

/** Treapta maximă: `next_tier` și `stamps_to_next_tier` lipsesc, ca pe server. */
const AT_THE_TOP: LoyaltyStatus = {
  stamps: 15,
  tier: GOLD,
  discountPercent: 20,
  nextTier: null,
  stampsToNextTier: null,
  tiers: TIERS,
  maxTotalDiscountPercent: 30,
};

/** Program de fidelitate oprit din panoul de admin: scara e goală. */
const NOT_CONFIGURED: LoyaltyStatus = {
  stamps: 7,
  tier: null,
  discountPercent: 0,
  nextTier: null,
  stampsToNextTier: null,
  tiers: [],
  maxTotalDiscountPercent: 0,
};

function httpError(status: number): AxiosError {
  const response = {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data: {},
  } as AxiosResponse;
  return new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, null, response);
}

beforeEach(() => {
  vi.mocked(fetchLoyaltyStatus).mockResolvedValue(ON_THE_WAY);
});

describe('progresul spre următoarea treaptă', () => {
  it('arată treapta curentă, reducerea ei și cât mai e până la următoarea', async () => {
    renderWithProviders(<LoyaltySection />);

    expect(await screen.findByTestId('loyalty-tier')).toHaveTextContent('Treapta Bronz');
    expect(screen.getByTestId('loyalty-discount')).toHaveTextContent('−5% la bilete');
    expect(screen.getByTestId('loyalty-stamps')).toHaveTextContent('4 ștampile strânse');
    expect(screen.getByTestId('loyalty-next')).toHaveTextContent(
      'Încă 2 ștampile până la treapta următoare',
    );
    // Recompensa are nume și cifră: „mai ai două" fără „pentru ce" nu motivează.
    expect(screen.getByTestId('loyalty-next')).toHaveTextContent(
      'Treapta Argint îți dă −10% la bilete.',
    );
  });

  it('bara pornește de la pragul treptei atinse, nu de la zero absolut', () => {
    // 4 ștampile, între Bronz (3) și Argint (6): o treime din drum.
    expect(progressPercent(ON_THE_WAY)).toBe(33);
  });

  it('bara e goală pentru cineva fără nicio ștampilă și plină pe ultima treaptă', () => {
    expect(progressPercent({ ...ON_THE_WAY, stamps: 0, tier: null })).toBe(0);
    expect(progressPercent(AT_THE_TOP)).toBe(100);
  });

  it('bara are valorile de accesibilitate ale progresului, nu doar o lățime', async () => {
    renderWithProviders(<LoyaltySection />);

    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '33');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAccessibleName('Progresul până la treapta Argint');
  });

  it('cineva sub prima treaptă vede că nu are încă una, dar vede drumul', async () => {
    vi.mocked(fetchLoyaltyStatus).mockResolvedValue({
      ...ON_THE_WAY,
      stamps: 1,
      tier: null,
      discountPercent: 0,
      stampsToNextTier: 2,
      nextTier: BRONZE,
    });
    renderWithProviders(<LoyaltySection />);

    expect(await screen.findByTestId('loyalty-tier')).toHaveTextContent('Încă nicio treaptă');
    expect(screen.queryByTestId('loyalty-discount')).not.toBeInTheDocument();
    expect(screen.getByTestId('loyalty-next')).toBeInTheDocument();
  });
});

describe('treapta maximă', () => {
  it('spune clar că e ultima treaptă, fără bară de progres', async () => {
    vi.mocked(fetchLoyaltyStatus).mockResolvedValue(AT_THE_TOP);
    renderWithProviders(<LoyaltySection />);

    expect(await screen.findByTestId('loyalty-max-tier')).toHaveTextContent(
      'Ești pe ultima treaptă.',
    );
    // O bară care nu se mai umple niciodată e o promisiune neonorată.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loyalty-next')).not.toBeInTheDocument();
    expect(screen.getByTestId('loyalty-discount')).toHaveTextContent('−20% la bilete');
  });
});

describe('backend fără programul configurat', () => {
  it('nu desenează nimic când scara de trepte e goală', async () => {
    vi.mocked(fetchLoyaltyStatus).mockResolvedValue(NOT_CONFIGURED);
    const { container } = renderWithProviders(<LoyaltySection />);

    // Așteptăm dispariția indicatorului, ca să nu confundăm „încă se încarcă"
    // cu „nu are ce arăta".
    await waitFor(() => {
      expect(screen.queryByTestId('loyalty-loading')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('loyalty-section')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('cardul întors direct fără trepte e tot gol, oricâte ștampile ar fi', () => {
    const { container } = renderWithProviders(<LoyaltyProgress status={NOT_CONFIGURED} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('stări oneste', () => {
  it('cât timp încarcă nu spune nici „ai o treaptă", nici „nu ai", ci arată un indicator', () => {
    vi.mocked(fetchLoyaltyStatus).mockReturnValue(new Promise<LoyaltyStatus>(() => {}));
    renderWithProviders(<LoyaltySection />);

    expect(screen.getByTestId('loyalty-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('loyalty-progress')).not.toBeInTheDocument();
  });

  it('fără rețea spune să verifici internetul', async () => {
    vi.mocked(fetchLoyaltyStatus).mockRejectedValue(new AxiosError('offline', 'ERR_NETWORK'));
    renderWithProviders(<LoyaltySection />);

    expect(await screen.findByTestId('loyalty-error')).toHaveTextContent(
      'Nu ai conexiune. Verifică internetul și încearcă din nou.',
    );
  });

  it('o eroare de server spune altceva decât lipsa rețelei, și se poate reîncerca', async () => {
    vi.mocked(fetchLoyaltyStatus).mockRejectedValueOnce(httpError(500));
    renderWithProviders(<LoyaltySection />);

    expect(await screen.findByTestId('loyalty-error')).toHaveTextContent(
      'Serverul nu a răspuns.',
    );

    vi.mocked(fetchLoyaltyStatus).mockResolvedValue(ON_THE_WAY);
    fireEvent.click(screen.getByTestId('loyalty-retry'));

    expect(await screen.findByTestId('loyalty-tier')).toHaveTextContent('Treapta Bronz');
  });
});

describe('formele de plural la rusă', () => {
  /**
   * Rusa are patru categorii (one / few / many / other), româna trei. O frază
   * construită prin concatenare ar produce „Ещё 5 штампа" — corect gramatical
   * doar din întâmplare, la 2, 3 și 4.
   */
  it.each([
    [1, 'Ещё 1 штамп до следующего уровня'],
    [3, 'Ещё 3 штампа до следующего уровня'],
    [5, 'Ещё 5 штампов до следующего уровня'],
    [21, 'Ещё 21 штамп до следующего уровня'],
  ])('%i ștampile rămase se scriu corect în rusă', async (count, expected) => {
    const initial = i18n.language;
    // Schimbarea limbii re-randează tot ce e montat, deci trece prin `act`.
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    try {
      vi.mocked(fetchLoyaltyStatus).mockResolvedValue({
        ...ON_THE_WAY,
        stampsToNextTier: count,
      });
      renderWithProviders(<LoyaltySection />);

      expect(await screen.findByTestId('loyalty-next')).toHaveTextContent(expected);
    } finally {
      await act(async () => {
        await i18n.changeLanguage(initial);
      });
    }
  });
});
