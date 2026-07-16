import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, AlertButton } from 'react-native';

import { ThemeProvider } from '@theme/index';

import { ProfileCard } from '../ProfileCard';
import { FeedCard } from '../types';

// ReportModal (deschis din card) folosește useMutation → mock la API.
jest.mock('@/features/moderation/reportApi', () => ({
  sendReport: jest.fn(),
}));

// Blocarea lovește backendul → mock la API-ul de setări.
const mockBlockUser = jest.fn((_userId: string) => Promise.resolve());
jest.mock('@/features/settings/settingsApi', () => ({
  blockUser: (userId: string) => mockBlockUser(userId),
}));

// ★ (favorite) lovește backendul → mock la API-ul social.
const mockAddFavorite = jest.fn((_userId: string) => Promise.resolve());
const mockFetchFavorites = jest.fn<Promise<unknown[]>, []>(() => Promise.resolve([]));
jest.mock('@/features/social/socialApi', () => ({
  addFavorite: (userId: string) => mockAddFavorite(userId),
  fetchFavorites: () => mockFetchFavorites(),
}));

/** Apasă butonul distructiv din Alert-ul de confirmare. */
function pressConfirm(spy: jest.SpyInstance): void {
  const buttons = spy.mock.calls[0][2] as AlertButton[] | undefined;
  const destructive = buttons?.find((b) => b.style === 'destructive');
  destructive?.onPress?.();
}

function makeCard(over: Partial<FeedCard> = {}): FeedCard {
  return {
    userId: 'u1',
    name: 'Ana',
    age: 27,
    gender: 'f',
    city: 'Chișinău',
    about: 'Îmi place drumețiile',
    topInterests: ['Muzică', 'Călătorii', 'Cafea', 'Extra'],
    languages: ['ro'],
    compatibility: 88,
    photos: [],
    ...over,
  };
}

function renderCard(card: FeedCard) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ProfileCard card={card} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ProfileCard', () => {
  it('afișează nume + vârstă, oraș și scorul de compatibilitate', () => {
    const { getByText } = renderCard(makeCard());
    expect(getByText('Ana, 27')).toBeTruthy();
    expect(getByText('Chișinău')).toBeTruthy();
    expect(getByText('88%')).toBeTruthy();
  });

  it('afișează cel mult 3 interese', () => {
    const { getByText, queryByText } = renderCard(makeCard());
    expect(getByText('Muzică')).toBeTruthy();
    expect(getByText('Călătorii')).toBeTruthy();
    expect(getByText('Cafea')).toBeTruthy();
    expect(queryByText('Extra')).toBeNull();
  });

  it('fără foto: afișează placeholder cu inițiala numelui', () => {
    const { getByText } = renderCard(makeCard({ name: 'Bogdan', photos: [] }));
    expect(getByText('B')).toBeTruthy();
  });

  it('include distanța când distanceKm e furnizat', () => {
    const { getByText } = renderCard(makeCard({ distanceKm: 4.6 }));
    expect(getByText('Chișinău · 5 km')).toBeTruthy();
  });

  it('apăsarea pe „Raportează" deschide ReportModal', () => {
    const { getByTestId, getByText } = renderCard(makeCard());
    fireEvent.press(getByTestId('card-report'));
    // Titlul modalului de raportare.
    expect(getByText('Raportează')).toBeTruthy();
    expect(getByText('Spam')).toBeTruthy();
  });

  /* --- Blocare din card (App Store Guideline 1.2) --- */

  describe('blocare', () => {
    beforeEach(() => mockBlockUser.mockClear());

    it('„Blochează" cere confirmare și NU blochează înainte de accept', () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const { getByTestId } = renderCard(makeCard());

      fireEvent.press(getByTestId('card-block'));

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][0]).toBe('Blochează utilizatorul');
      expect(mockBlockUser).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    it('după confirmare apelează blockUser cu id-ul din card', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const { getByTestId } = renderCard(makeCard({ userId: 'u42' }));

      fireEvent.press(getByTestId('card-block'));
      pressConfirm(alertSpy);

      await waitFor(() => expect(mockBlockUser).toHaveBeenCalledWith('u42'));

      alertSpy.mockRestore();
    });
  });

  /* --- Favorite din card (★) --- */

  describe('favorite', () => {
    beforeEach(() => {
      mockAddFavorite.mockClear();
      mockFetchFavorites.mockReset();
      mockFetchFavorites.mockResolvedValue([]);
    });

    it('★ apelează addFavorite cu id-ul din card', async () => {
      const { getByTestId } = renderCard(makeCard({ userId: 'u7' }));

      fireEvent.press(getByTestId('card-favorite'));

      await waitFor(() => expect(mockAddFavorite).toHaveBeenCalledWith('u7'));
    });

    it('profil DEJA favorit: steaua e plină și butonul nu mai trimite nimic', async () => {
      mockFetchFavorites.mockResolvedValue([
        { targetUserId: 'u7', name: 'Ana', age: 27, city: 'Chișinău', photos: [] },
      ]);
      const { getByTestId, getByLabelText } = renderCard(makeCard({ userId: 'u7' }));

      await waitFor(() => getByLabelText('Deja la favorite'));
      fireEvent.press(getByTestId('card-favorite'));

      expect(mockAddFavorite).not.toHaveBeenCalled();
    });
  });
});
