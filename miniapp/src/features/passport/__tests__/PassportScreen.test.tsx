/**
 * Flirt Passport: ștampile, cardul de reduceri și stările ecranului.
 *
 * Rețeaua e mockată la nivelul modulului local `passportApi` (care re-exportă
 * funcțiile pure din Expo): testele verifică deciziile ecranului — ce arată, ce
 * ascunde și cum se reîncearcă — nu axios.
 */
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PassportStamp } from '@mobile/features/events/types';
import type { Subscription } from '@mobile/features/subscription/types';

import { renderWithProviders } from '@/test/harness';

import { PassportScreen } from '../PassportScreen';

vi.mock('../passportApi', () => ({
  fetchPassport: vi.fn(),
  fetchMySubscription: vi.fn(),
}));

const { fetchMySubscription, fetchPassport } = await import('../passportApi');

const STAMPS: PassportStamp[] = [
  {
    eventId: 'e1',
    eventTitle: 'Flirt Party Chișinău',
    city: 'Chișinău',
    stampedAt: '2026-03-14T20:00:00Z',
  },
  {
    eventId: 'e2',
    eventTitle: 'Concert la Bălți',
    city: 'Bălți',
    stampedAt: '2026-04-02T19:30:00Z',
  },
];

/** Card de reduceri activ (`card_5`): backendul dă contorul de intrări. */
const CARD: Subscription = {
  plan: 'card_5',
  status: 'active',
  expiresAt: '2026-12-31T00:00:00Z',
  entriesTotal: 5,
  entriesRemaining: 3,
};

/** Abonament fără intrări (ex. premium): nu are card de reduceri. */
const PREMIUM: Subscription = {
  plan: 'premium',
  status: 'active',
  expiresAt: '2026-12-31T00:00:00Z',
  entriesTotal: null,
  entriesRemaining: null,
};

beforeEach(() => {
  vi.mocked(fetchPassport).mockResolvedValue(STAMPS);
  vi.mocked(fetchMySubscription).mockResolvedValue(null);
});

describe('ștampile', () => {
  it('arată titlul, orașul și data fiecărei ștampile', async () => {
    renderWithProviders(<PassportScreen />);

    const stamps = await screen.findAllByTestId('passport-stamp');
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toHaveTextContent('Flirt Party Chișinău');
    expect(stamps[0]).toHaveTextContent('Chișinău');
    // Doar ziua, fără oră: `formatStampDate`, în limba interfeței (ro).
    expect(stamps[0]).toHaveTextContent('14 martie 2026');
    expect(stamps[1]).toHaveTextContent('Concert la Bălți');
  });

  it('numele produsului nu se traduce', async () => {
    renderWithProviders(<PassportScreen />);

    expect(await screen.findByRole('heading', { name: 'Flirt Passport' })).toBeInTheDocument();
  });
});

describe('stări oneste', () => {
  it('cât timp încarcă, nu spune „nu ai ștampile"', () => {
    vi.mocked(fetchPassport).mockReturnValue(new Promise<PassportStamp[]>(() => {}));
    renderWithProviders(<PassportScreen />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('passport-empty')).not.toBeInTheDocument();
  });

  it('lista goală are un text care îndeamnă la un eveniment', async () => {
    vi.mocked(fetchPassport).mockResolvedValue([]);
    renderWithProviders(<PassportScreen />);

    expect(await screen.findByTestId('passport-empty')).toHaveTextContent(
      'Încă nu ai ștampile — participă la un eveniment!',
    );
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchPassport).mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<PassportScreen />);

    expect(await screen.findByTestId('passport-error')).toHaveTextContent(
      'Nu am putut încărca Flirt Passport.',
    );

    vi.mocked(fetchPassport).mockResolvedValue(STAMPS);
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
  });
});

describe('cardul de reduceri', () => {
  it('apare pentru planurile card, cu intrările rămase la plural corect', async () => {
    vi.mocked(fetchMySubscription).mockResolvedValue(CARD);
    renderWithProviders(<PassportScreen />);

    const card = await screen.findByTestId('passport-discount-card');
    expect(card).toHaveTextContent('3 intrări rămase din 5');
    expect(card).toHaveTextContent('CARD REDUCERI');
    expect(card).toHaveAttribute(
      'aria-label',
      'Card reduceri: 3 intrări rămase din 5',
    );
    expect(screen.getByRole('heading', { name: 'Reducerile mele' })).toBeInTheDocument();
  });

  it('singura intrare rămasă folosește forma de singular', async () => {
    vi.mocked(fetchMySubscription).mockResolvedValue({ ...CARD, entriesRemaining: 1 });
    renderWithProviders(<PassportScreen />);

    expect(await screen.findByTestId('passport-discount-card')).toHaveTextContent(
      '1 intrare rămasă din 5',
    );
  });

  it('lipsește pentru un abonament fără intrări', async () => {
    vi.mocked(fetchMySubscription).mockResolvedValue(PREMIUM);
    renderWithProviders(<PassportScreen />);

    await screen.findAllByTestId('passport-stamp');
    expect(screen.queryByTestId('passport-discount-card')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reducerile mele' })).not.toBeInTheDocument();
  });

  it('apare și când nu există încă nicio ștampilă', async () => {
    vi.mocked(fetchPassport).mockResolvedValue([]);
    vi.mocked(fetchMySubscription).mockResolvedValue(CARD);
    renderWithProviders(<PassportScreen />);

    expect(await screen.findByTestId('passport-discount-card')).toBeInTheDocument();
    expect(screen.getByTestId('passport-empty')).toBeInTheDocument();
  });

  it('un abonament care nu se poate aduce nu strică passportul', async () => {
    vi.mocked(fetchMySubscription).mockRejectedValue(new Error('offline'));
    renderWithProviders(<PassportScreen />);

    expect(await screen.findAllByTestId('passport-stamp')).toHaveLength(2);
    expect(screen.queryByTestId('passport-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('passport-discount-card')).not.toBeInTheDocument();
  });
});
