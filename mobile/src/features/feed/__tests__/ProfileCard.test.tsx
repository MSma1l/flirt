import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { ProfileCard } from '../ProfileCard';
import { FeedCard } from '../types';

// ReportModal (deschis din card) folosește useMutation → mock la API.
jest.mock('@/features/moderation/reportApi', () => ({
  sendReport: jest.fn(),
}));

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
    const { getByLabelText, getByText } = renderCard(makeCard());
    fireEvent.press(getByLabelText('Raportează'));
    // Titlul modalului de raportare.
    expect(getByText('Raportează')).toBeTruthy();
    expect(getByText('Spam')).toBeTruthy();
  });
});
