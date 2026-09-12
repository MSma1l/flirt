/**
 * Lista de blocare: stări oneste, paginare pe cursor și deblocarea cu
 * confirmare proprie (niciodată `confirm()`).
 *
 * Rețeaua e mockată la nivelul modulului local `socialApi` — testele verifică
 * deciziile ecranului, nu axios.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockedUser, BlocksPage } from '@mobile/features/settings/settingsApi';

import { renderWithProviders } from '@/test/harness';

import { BlocklistScreen } from '../BlocklistScreen';

vi.mock('../socialApi', () => ({
  fetchFavoritesPage: vi.fn(),
  fetchLikesSentPage: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  fetchBlocks: vi.fn(),
  unblock: vi.fn(),
}));

const { fetchBlocks, unblock } = await import('../socialApi');

const DAN: BlockedUser = { blockedId: 'b1', name: 'Dan' };
const EMA: BlockedUser = { blockedId: 'b2', name: 'Ema' };

function page(items: BlockedUser[], nextCursor: string | null = null): BlocksPage {
  return { items, nextCursor };
}

beforeEach(() => {
  vi.mocked(fetchBlocks).mockResolvedValue(page([DAN]));
  vi.mocked(unblock).mockResolvedValue(undefined);
});

describe('stări oneste', () => {
  it('cât timp încarcă, nu spune „nu ai utilizatori blocați"', () => {
    vi.mocked(fetchBlocks).mockReturnValue(new Promise<BlocksPage>(() => {}));
    renderWithProviders(<BlocklistScreen />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('blocklist-empty')).not.toBeInTheDocument();
  });

  it('lista goală are un text explicativ', async () => {
    vi.mocked(fetchBlocks).mockResolvedValue(page([]));
    renderWithProviders(<BlocklistScreen />);

    expect(await screen.findByTestId('blocklist-empty')).toHaveTextContent(
      'Nu ai utilizatori blocați.',
    );
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchBlocks).mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<BlocklistScreen />);

    expect(await screen.findByTestId('blocklist-error')).toHaveTextContent(
      'Nu am putut încărca lista.',
    );

    vi.mocked(fetchBlocks).mockResolvedValue(page([DAN]));
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByText('Dan')).toBeInTheDocument();
  });
});

describe('deblocare', () => {
  it('trece prin confirmare și, la accept, dispare din listă', async () => {
    renderWithProviders(<BlocklistScreen />);

    fireEvent.click(await screen.findByTestId('blocklist-unblock-b1'));

    const dialog = screen.getByTestId('blocklist-confirm');
    expect(dialog).toHaveAccessibleName('Deblochează');
    expect(dialog).toHaveTextContent('Îl deblochezi pe Dan?');

    vi.mocked(fetchBlocks).mockResolvedValue(page([]));
    fireEvent.click(screen.getByTestId('blocklist-confirm-accept'));

    await waitFor(() => expect(unblock).toHaveBeenCalledWith('b1'));
    expect(await screen.findByTestId('blocklist-empty')).toBeInTheDocument();
  });

  it('anularea nu trimite nimic la server', async () => {
    renderWithProviders(<BlocklistScreen />);

    fireEvent.click(await screen.findByTestId('blocklist-unblock-b1'));
    fireEvent.click(screen.getByTestId('blocklist-confirm-cancel'));

    expect(screen.queryByTestId('blocklist-confirm')).not.toBeInTheDocument();
    expect(unblock).not.toHaveBeenCalled();
    expect(screen.getByText('Dan')).toBeInTheDocument();
  });

  it('eșecul se scrie în pagină, iar lista NU se golește', async () => {
    vi.mocked(unblock).mockRejectedValue(new Error('500'));
    renderWithProviders(<BlocklistScreen />);

    fireEvent.click(await screen.findByTestId('blocklist-unblock-b1'));
    fireEvent.click(screen.getByTestId('blocklist-confirm-accept'));

    expect(await screen.findByTestId('blocklist-unblock-error')).toHaveTextContent(
      'Nu am putut debloca utilizatorul. Reîncearcă.',
    );
    expect(screen.getByText('Dan')).toBeInTheDocument();
    expect(screen.getByTestId('blocklist-unblock-b1')).toBeInTheDocument();
  });
});

describe('paginare pe cursor', () => {
  it('„Încarcă mai multe" adaugă pagina următoare sub cea adusă', async () => {
    vi.mocked(fetchBlocks)
      .mockResolvedValueOnce(page([DAN], 'cursor-2'))
      .mockResolvedValueOnce(page([EMA]));
    renderWithProviders(<BlocklistScreen />);

    fireEvent.click(await screen.findByTestId('blocks-load-more'));

    expect(await screen.findByText('Ema')).toBeInTheDocument();
    expect(screen.getByText('Dan')).toBeInTheDocument();
    expect(fetchBlocks).toHaveBeenLastCalledWith({ cursor: 'cursor-2' });
  });

  it('o eroare la pagina 2 NU șterge pagina 1', async () => {
    vi.mocked(fetchBlocks)
      .mockResolvedValueOnce(page([DAN], 'cursor-2'))
      .mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<BlocklistScreen />);

    fireEvent.click(await screen.findByTestId('blocks-load-more'));

    expect(await screen.findByTestId('blocks-load-more-error')).toHaveTextContent(
      'Nu am putut încărca mai multe.',
    );
    expect(screen.getByText('Dan')).toBeInTheDocument();
    expect(screen.queryByTestId('blocklist-error')).not.toBeInTheDocument();
  });
});
