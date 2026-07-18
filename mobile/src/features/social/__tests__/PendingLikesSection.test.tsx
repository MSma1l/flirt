import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { PendingLikesSection } from '../PendingLikesSection';
import type { PendingLikeItem } from '../socialApi';
import { ThemeProvider } from '@theme/index';

const mockFetchPending = jest.fn();
jest.mock('../socialApi', () => ({
  fetchPendingLikesPage: (params: unknown) => mockFetchPending(params),
}));

function makeItem(over: Partial<PendingLikeItem> = {}): PendingLikeItem {
  return {
    targetUserId: 'u1',
    name: 'Ana',
    age: 25,
    city: 'Chișinău',
    photos: [],
    isSuper: false,
    myMessage: null,
    ...over,
  };
}

function renderSection(showEmpty = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PendingLikesSection showEmpty={showEmpty} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('PendingLikesSection', () => {
  beforeEach(() => mockFetchPending.mockReset());

  it('arată un spinner cât timp se încarcă (distinct de gol)', () => {
    mockFetchPending.mockReturnValue(new Promise(() => {})); // niciodată rezolvat
    const { getByTestId, queryByTestId } = renderSection();
    expect(getByTestId('pending-loading')).toBeTruthy();
    expect(queryByTestId('pending-empty')).toBeNull();
  });

  it('randează cardurile cu badge super și mesajul scris de tine', async () => {
    mockFetchPending.mockResolvedValue({
      items: [makeItem({ isSuper: true, myMessage: 'Salut' })],
      nextCursor: null,
    });
    const { getByText, getByTestId } = renderSection();

    await waitFor(() => getByText('Ana, 25'));
    expect(getByTestId('pending-super-u1')).toBeTruthy();
    expect(getByText('Ai scris: «Salut»')).toBeTruthy();
    expect(getByText('Așteaptă să-ți răspundă')).toBeTruthy();
  });

  it('ascunsă complet când e goală și showEmpty=false (fără spațiu mort)', async () => {
    mockFetchPending.mockResolvedValue({ items: [], nextCursor: null });
    const { queryByText, queryByTestId } = renderSection(false);

    await waitFor(() => expect(queryByTestId('pending-loading')).toBeNull());
    expect(queryByText('În așteptare')).toBeNull();
    expect(queryByTestId('pending-empty')).toBeNull();
  });

  it('arată textul de gol când showEmpty=true', async () => {
    mockFetchPending.mockResolvedValue({ items: [], nextCursor: null });
    const { getByTestId } = renderSection(true);

    await waitFor(() => getByTestId('pending-empty'));
  });

  it('arată eroarea când prima pagină pică', async () => {
    mockFetchPending.mockRejectedValue(new Error('boom'));
    const { getByTestId } = renderSection();

    await waitFor(() => getByTestId('pending-error'));
    expect(getByTestId('pending-retry')).toBeTruthy();
  });
});
