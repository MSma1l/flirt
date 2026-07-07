import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { ReportModal } from '../ReportModal';

jest.mock('../reportApi', () => ({
  sendReport: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendReport } = require('../reportApi');

function renderModal(props: Partial<React.ComponentProps<typeof ReportModal>> = {}) {
  const onClose = jest.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ReportModal
          visible
          reportedUserId="u2"
          chatId="c1"
          onClose={onClose}
          {...props}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe('ReportModal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite raportul cu categoria selectată', async () => {
    (sendReport as jest.Mock).mockResolvedValue(undefined);
    const { getByText } = renderModal();

    fireEvent.press(getByText('Limbaj ofensator'));
    fireEvent.press(getByText('Trimite raportul'));

    await waitFor(() => {
      expect(sendReport).toHaveBeenCalledTimes(1);
    });
    expect(sendReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedUserId: 'u2',
        chatId: 'c1',
        category: 'offensive',
      }),
    );
  });

  it('afișează mesajul de mulțumire la succes', async () => {
    (sendReport as jest.Mock).mockResolvedValue(undefined);
    const { getByText } = renderModal();

    fireEvent.press(getByText('Spam'));
    fireEvent.press(getByText('Trimite raportul'));

    await waitFor(() => {
      expect(getByText('Mulțumim, am primit raportul')).toBeTruthy();
    });
  });

  it('nu trimite raportul fără o categorie selectată', () => {
    const { getByText } = renderModal();
    fireEvent.press(getByText('Trimite raportul'));
    expect(sendReport).not.toHaveBeenCalled();
  });

  it('afișează toate categoriile disponibile', () => {
    const { getByText } = renderModal();
    ['Spam', 'Profil fals', 'Limbaj ofensator', 'Conținut obscen'].forEach((label) => {
      expect(getByText(label)).toBeTruthy();
    });
  });

  it('marchează categoria selectată în starea de accesibilitate', () => {
    const { getByText, getByRole } = renderModal();
    // Înainte de selecție nu există niciun buton „selected".
    expect(() => getByRole('button', { selected: true })).toThrow();
    fireEvent.press(getByText('Spam'));
    // După selecție, butonul categoriei apare marcat ca selectat.
    expect(getByRole('button', { selected: true })).toBeTruthy();
  });

  it('afișează mesajul de eroare când trimiterea eșuează', async () => {
    (sendReport as jest.Mock).mockRejectedValue(new Error('network'));
    const { getByText } = renderModal();

    fireEvent.press(getByText('Profil fals'));
    fireEvent.press(getByText('Trimite raportul'));

    await waitFor(() => {
      expect(getByText('Nu am putut trimite raportul. Încearcă din nou.')).toBeTruthy();
    });
  });

  it('nota cu marcaje HTML blochează trimiterea și arată eroarea', () => {
    const { getByText, getByPlaceholderText } = renderModal();

    fireEvent.press(getByText('Spam'));
    fireEvent.changeText(
      getByPlaceholderText('Detalii suplimentare…'),
      '<script>alert(1)</script>',
    );
    fireEvent.press(getByText('Trimite raportul'));

    expect(getByText('Textul nu poate conține marcaje HTML.')).toBeTruthy();
    expect(sendReport).not.toHaveBeenCalled();
  });

  it('butonul „Anulează" apelează onClose', () => {
    const { getByText, onClose } = renderModal();
    fireEvent.press(getByText('Anulează'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
