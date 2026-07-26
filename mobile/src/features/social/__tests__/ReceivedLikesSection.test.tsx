import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { ReceivedLikesSection } from '../ReceivedLikesSection';
import type { ReceivedLikeItem } from '../receivedApi';
import { ThemeProvider } from '@theme/index';

// Mock router: verificăm navigarea către ecranul de detaliu al cererii.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

const mockFetchReceived = jest.fn();
jest.mock('../receivedApi', () => ({
  fetchReceivedLikesPage: (params: unknown) => mockFetchReceived(params),
}));

function makeItem(over: Partial<ReceivedLikeItem> = {}): ReceivedLikeItem {
  return {
    userId: 'u1',
    isSuper: false,
    message: null,
    createdAt: '2026-07-24T10:00:00Z',
    profile: {
      name: 'Ana',
      age: 25,
      gender: 'female',
      city: 'Chișinău',
      about: 'Îmi place drumețiile.',
      photos: [],
      topInterests: ['muzică'],
      languages: ['ro'],
    },
    ...over,
  };
}

function renderSection(showEmpty = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ReceivedLikesSection showEmpty={showEmpty} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ReceivedLikesSection', () => {
  beforeEach(() => {
    mockFetchReceived.mockReset();
    mockPush.mockClear();
  });

  it('arată un spinner cât timp se încarcă (distinct de gol)', () => {
    mockFetchReceived.mockReturnValue(new Promise(() => {})); // niciodată rezolvat
    const { getByTestId, queryByTestId } = renderSection();
    expect(getByTestId('received-loading')).toBeTruthy();
    expect(queryByTestId('received-empty')).toBeNull();
  });

  it('randează o cerere CU mesaj și badge super', async () => {
    mockFetchReceived.mockResolvedValue({
      items: [makeItem({ isSuper: true, message: 'Salut, ce faci?' })],
      nextCursor: null,
    });
    const { getByText, getByTestId } = renderSection();

    await waitFor(() => getByText('Ana, 25'));
    expect(getByTestId('received-super-u1')).toBeTruthy();
    expect(getByTestId('received-message-u1')).toBeTruthy();
    expect(getByText('Salut, ce faci?')).toBeTruthy();
  });

  it('randează o cerere FĂRĂ mesaj (doar like)', async () => {
    mockFetchReceived.mockResolvedValue({
      items: [makeItem({ message: null })],
      nextCursor: null,
    });
    const { getByText, queryByTestId } = renderSection();

    await waitFor(() => getByText('Ana, 25'));
    expect(queryByTestId('received-message-u1')).toBeNull();
    expect(getByText('Ți-a dat like, fără mesaj.')).toBeTruthy();
  });

  it('tap pe un rând deschide detaliul cererii /requests/{userId}', async () => {
    mockFetchReceived.mockResolvedValue({ items: [makeItem()], nextCursor: null });
    const { getByTestId } = renderSection();

    await waitFor(() => getByTestId('received-u1'));
    fireEvent.press(getByTestId('received-u1'));
    expect(mockPush).toHaveBeenCalledWith('/requests/u1');
  });

  it('ascunsă complet când e goală și showEmpty=false (fără spațiu mort)', async () => {
    mockFetchReceived.mockResolvedValue({ items: [], nextCursor: null });
    const { queryByText, queryByTestId } = renderSection(false);

    await waitFor(() => expect(queryByTestId('received-loading')).toBeNull());
    expect(queryByText('Ți-au dat like')).toBeNull();
    expect(queryByTestId('received-empty')).toBeNull();
  });

  it('arată textul de gol când showEmpty=true', async () => {
    mockFetchReceived.mockResolvedValue({ items: [], nextCursor: null });
    const { getByTestId } = renderSection(true);

    await waitFor(() => getByTestId('received-empty'));
  });

  it('arată eroarea când prima pagină pică', async () => {
    mockFetchReceived.mockRejectedValue(new Error('boom'));
    const { getByTestId } = renderSection();

    await waitFor(() => getByTestId('received-error'));
    expect(getByTestId('received-retry')).toBeTruthy();
  });
});
