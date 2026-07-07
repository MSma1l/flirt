import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import BlocklistScreen from '../blocklist';
import { ThemeProvider } from '@theme/index';
import type { BlockedUser } from '@/features/settings/settingsApi';

// Mock router + Stack.Screen (evită expo-router real).
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la settingsApi: listă controlată + spionăm deblocarea.
const mockFetchBlocks = jest.fn<Promise<BlockedUser[]>, []>(() => Promise.resolve([]));
const mockUnblock = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/features/settings/settingsApi', () => ({
  fetchBlocks: () => mockFetchBlocks(),
  unblock: (id: string) => mockUnblock(id),
}));

const blocks: BlockedUser[] = [
  { blockedId: 'b1', name: 'Ion' },
  { blockedId: 'b2', name: 'Vlad' },
];

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
    mockFetchBlocks.mockResolvedValue(blocks);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ion'));
    expect(getByText('Vlad')).toBeTruthy();
  });

  it('afișează starea goală', async () => {
    mockFetchBlocks.mockResolvedValue([]);
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Nu ai utilizatori blocați.'));
  });

  it('deblocarea apelează unblock', async () => {
    mockFetchBlocks.mockResolvedValue(blocks);
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('unblock-b1'));
    fireEvent.press(getByTestId('unblock-b1'));

    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('b1'));
  });
});
