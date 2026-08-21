import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import TicketScreen from '../ticket';
import i18n from '@/i18n';
import { ThemeProvider } from '@theme/index';
import type { Ticket } from '@/features/settings/settingsApi';

// Mock router + Stack.Screen (evită expo-router real).
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la settingsApi: biletul controlat.
const mockFetchTicket = jest.fn<Promise<Ticket>, []>(() =>
  Promise.resolve({ code: 'FLIRT-1234', used: false }),
);
jest.mock('@/features/settings/settingsApi', () => ({
  fetchTicket: () => mockFetchTicket(),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TicketScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TicketScreen', () => {
  beforeEach(() => {
    mockFetchTicket.mockReset();
  });

  it('afișează codul biletului și statusul NEFOLOSIT', async () => {
    mockFetchTicket.mockResolvedValue({ code: 'FLIRT-1234', used: false });
    const { getByTestId, getAllByText, getByText } = renderScreen();

    await waitFor(() => getByTestId('ticket-card'));
    // Codul apare în „QR" și în zona de cod.
    expect(getAllByText('FLIRT-1234').length).toBeGreaterThan(0);
    expect(getByText('NEFOLOSIT')).toBeTruthy();
  });

  it('afișează statusul FOLOSIT pentru un bilet consumat', async () => {
    mockFetchTicket.mockResolvedValue({ code: 'FLIRT-9999', used: true });
    const { getByText } = renderScreen();

    await waitFor(() => getByText('FOLOSIT'));
  });

  describe('i18n', () => {
    afterEach(async () => {
      await i18n.changeLanguage('ro');
    });

    it('titlul, instrucțiunea și starea biletului urmează limba activă', async () => {
      mockFetchTicket.mockResolvedValue({ code: 'ABCD1234', used: false });
      await i18n.changeLanguage('ru');
      const { getByText } = renderScreen();

      await waitFor(() => getByText('Мой билет Flirt Party'));
      expect(getByText('Покажите этот билет на входе. Он действителен только один раз.')).toBeTruthy();
      expect(getByText('Код билета')).toBeTruthy();
      expect(getByText('НЕ ИСПОЛЬЗОВАН')).toBeTruthy();
    });

    it('biletul folosit se anunță în limba activă', async () => {
      mockFetchTicket.mockResolvedValue({ code: 'ABCD1234', used: true });
      await i18n.changeLanguage('en');
      const { getByText } = renderScreen();

      await waitFor(() => getByText('USED'));
      expect(getByText('My Flirt Party ticket')).toBeTruthy();
    });
  });
});
