import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import BlocklistScreen from '../blocklist';
import { ThemeProvider } from '@theme/index';
import type { BlockedUser, BlocksPage, BlocksPageParams } from '@/features/settings/settingsApi';

// Mock router + Stack.Screen (evită expo-router real).
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la settingsApi: pagini controlate + spionăm deblocarea.
const mockFetchBlocks = jest.fn<Promise<BlocksPage>, [BlocksPageParams | undefined]>(() =>
  Promise.resolve({ items: [], nextCursor: null }),
);
const mockUnblock = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/features/settings/settingsApi', () => ({
  fetchBlocks: (params?: BlocksPageParams) => mockFetchBlocks(params),
  unblock: (id: string) => mockUnblock(id),
}));

const blocks: BlockedUser[] = [
  { blockedId: 'b1', name: 'Ion' },
  { blockedId: 'b2', name: 'Vlad' },
];

/** O pagină „ultima" (fără cursor mai departe). */
function lastPage(items: BlockedUser[]): BlocksPage {
  return { items, nextCursor: null };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <BlocklistScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('BlocklistScreen', () => {
  beforeEach(() => {
    mockFetchBlocks.mockReset();
    mockUnblock.mockClear();
  });

  it('randează lista de utilizatori blocați', async () => {
    mockFetchBlocks.mockResolvedValue(lastPage(blocks));
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ion'));
    expect(getByText('Vlad')).toBeTruthy();
  });

  it('afișează starea goală', async () => {
    mockFetchBlocks.mockResolvedValue(lastPage([]));
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Nu ai utilizatori blocați.'));
  });

  it('deblocarea apelează unblock', async () => {
    mockFetchBlocks.mockResolvedValue(lastPage(blocks));
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('unblock-b1'));
    fireEvent.press(getByTestId('unblock-b1'));

    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('b1'));
  });

  /* --- Paginare pe cursor --- */

  it('prima pagină cere limit fără cursor', async () => {
    mockFetchBlocks.mockResolvedValue(lastPage(blocks));
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ion'));
    expect(mockFetchBlocks).toHaveBeenCalledWith({ cursor: null });
  });

  it('fără X-Next-Cursor butonul „încarcă mai multe" NU apare', async () => {
    mockFetchBlocks.mockResolvedValue(lastPage(blocks));
    const { getByText, queryByTestId } = renderScreen();

    await waitFor(() => getByText('Ion'));
    expect(queryByTestId('blocks-load-more')).toBeNull();
  });

  it('cu X-Next-Cursor apare butonul, iar pagina 2 se ADAUGĂ la pagina 1', async () => {
    mockFetchBlocks
      .mockResolvedValueOnce({ items: blocks, nextCursor: 'C2' })
      .mockResolvedValueOnce(lastPage([{ blockedId: 'b3', name: 'Radu' }]));
    const { getByText, getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('blocks-load-more'));
    fireEvent.press(getByTestId('blocks-load-more'));

    // Pagina 2 e cerută cu cursorul primit în header.
    await waitFor(() => expect(mockFetchBlocks).toHaveBeenLastCalledWith({ cursor: 'C2' }));
    await waitFor(() => getByText('Radu'));

    // Pagina 1 NU a fost înlocuită.
    expect(getByText('Ion')).toBeTruthy();
    expect(getByText('Vlad')).toBeTruthy();
    // Lista s-a terminat → butonul dispare.
    expect(queryByTestId('blocks-load-more')).toBeNull();
  });

  it('eroare la pagina 2: pagina 1 rămâne pe ecran + mesaj', async () => {
    mockFetchBlocks
      .mockResolvedValueOnce({ items: blocks, nextCursor: 'C2' })
      .mockRejectedValueOnce(new Error('boom'));
    const { getByText, getByTestId, queryByText } = renderScreen();

    await waitFor(() => getByTestId('blocks-load-more'));
    fireEvent.press(getByTestId('blocks-load-more'));

    await waitFor(() => getByTestId('blocks-load-more-error'));

    // Pagina 1 e intactă, ecranul de eroare NU a acoperit lista.
    expect(getByText('Ion')).toBeTruthy();
    expect(getByText('Vlad')).toBeTruthy();
    expect(queryByText('Nu am putut încărca lista.')).toBeNull();
  });
});
