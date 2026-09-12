/**
 * Ecranul „Favorite": secțiuni, stări oneste, paginare și acțiunile de rând.
 *
 * Stratul de rețea e izolat în modulul local `socialApi` (care re-exportă
 * funcțiile pure din aplicația Expo), ca testele să verifice DECIZIILE
 * ecranului, nu axios.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FavoriteItem, Page } from '@mobile/features/social/socialApi';

import { renderWithProviders } from '@/test/harness';

import { FavoritesScreen } from '../FavoritesScreen';

vi.mock('../socialApi', () => ({
  fetchFavoritesPage: vi.fn(),
  fetchLikesSentPage: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  fetchBlocks: vi.fn(),
  unblock: vi.fn(),
}));

const { addFavorite, fetchFavoritesPage, fetchLikesSentPage, removeFavorite } = await import(
  '../socialApi'
);

const ANA: FavoriteItem = {
  targetUserId: 'u1',
  name: 'Ana',
  age: 27,
  city: 'Chișinău',
  photos: ['https://cdn.example/ana.jpg'],
};
const BOGDAN: FavoriteItem = {
  targetUserId: 'u2',
  name: 'Bogdan',
  age: 31,
  city: 'Bălți',
  // Fără poze: avatarul trebuie să cadă pe inițiala numelui.
  photos: [],
};
const CARINA: FavoriteItem = {
  targetUserId: 'u3',
  name: 'Carina',
  age: 24,
  city: 'Orhei',
  photos: [],
};

function page(items: FavoriteItem[], nextCursor: string | null = null): Page<FavoriteItem> {
  return { items, nextCursor };
}

/** Promisiune care nu se termină niciodată — ține interogarea în „încărcare". */
function pending(): Promise<Page<FavoriteItem>> {
  return new Promise<Page<FavoriteItem>>(() => {});
}

beforeEach(() => {
  vi.mocked(fetchFavoritesPage).mockResolvedValue(page([BOGDAN]));
  vi.mocked(fetchLikesSentPage).mockResolvedValue(page([ANA]));
  vi.mocked(removeFavorite).mockResolvedValue(undefined);
  vi.mocked(addFavorite).mockResolvedValue(undefined);
});

describe('randare', () => {
  it('arată cele două secțiuni etichetate, cu explicațiile lor', async () => {
    renderWithProviders(<FavoritesScreen />);

    expect(await screen.findByRole('heading', { name: 'Le-ai dat like' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Favorite ★' })).toBeInTheDocument();
    expect(
      screen.getByText('Profilurile pe care le-ai apreciat cu swipe dreapta.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Profilurile pe care le-ai marcat manual cu ★.')).toBeInTheDocument();
  });

  it('rândul are nume, vârstă, oraș și acțiunea potrivită secțiunii', async () => {
    renderWithProviders(<FavoritesScreen />);

    expect(await screen.findByText('Ana, 27')).toBeInTheDocument();
    expect(screen.getByText('Chișinău')).toBeInTheDocument();
    expect(screen.getByText('Bogdan, 31')).toBeInTheDocument();

    // ♥ în „Favorite ★" (scoate), ☆ în „Le-ai dat like" (adaugă).
    expect(screen.getByTestId('favorite-remove-u2')).toHaveTextContent('♥');
    expect(screen.getByTestId('like-favorite-u1')).toHaveTextContent('☆');
  });

  it('un profil deja favorit are steaua plină și butonul blocat', async () => {
    // Aceeași persoană în ambele liste: ★ nu mai are ce adăuga.
    vi.mocked(fetchFavoritesPage).mockResolvedValue(page([ANA]));
    renderWithProviders(<FavoritesScreen />);

    const star = await screen.findByTestId('like-favorite-u1');
    expect(star).toHaveTextContent('★');
    expect(star).toBeDisabled();
    expect(star).toHaveAttribute('aria-label', 'Ana e deja la favorite');
  });

  it('fără poză, avatarul cade pe inițiala numelui', async () => {
    renderWithProviders(<FavoritesScreen />);

    expect(await screen.findByText('B')).toBeInTheDocument();
  });

  it('secțiunile goale nu se randează', async () => {
    vi.mocked(fetchFavoritesPage).mockResolvedValue(page([]));
    renderWithProviders(<FavoritesScreen />);

    expect(await screen.findByRole('heading', { name: 'Le-ai dat like' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Favorite ★' })).not.toBeInTheDocument();
  });
});

describe('stări oneste', () => {
  it('cât timp încarcă, nu spune „nu ai favorite"', () => {
    vi.mocked(fetchFavoritesPage).mockReturnValue(pending());
    vi.mocked(fetchLikesSentPage).mockReturnValue(pending());
    renderWithProviders(<FavoritesScreen />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('favorites-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('favorites-error')).not.toBeInTheDocument();
  });

  it('ambele liste goale → un text care explică de ce', async () => {
    vi.mocked(fetchFavoritesPage).mockResolvedValue(page([]));
    vi.mocked(fetchLikesSentPage).mockResolvedValue(page([]));
    renderWithProviders(<FavoritesScreen />);

    const empty = await screen.findByTestId('favorites-empty');
    expect(empty).toHaveTextContent('Încă n-ai dat like nimănui și n-ai marcat pe nimeni cu ★.');
    expect(empty).toHaveTextContent('Profilurile apreciate în deck apar aici automat.');
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchFavoritesPage).mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<FavoritesScreen />);

    expect(await screen.findByTestId('favorites-error')).toHaveTextContent(
      'Nu am putut încărca lista.',
    );

    vi.mocked(fetchFavoritesPage).mockResolvedValue(page([BOGDAN]));
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByText('Bogdan, 31')).toBeInTheDocument();
  });
});

describe('scoaterea din favorite', () => {
  it('trece prin confirmare și, la accept, dispare din listă', async () => {
    renderWithProviders(<FavoritesScreen />);

    fireEvent.click(await screen.findByTestId('favorite-remove-u2'));

    // Confirmarea e a NOASTRĂ, în DOM — niciodată `confirm()`.
    expect(screen.getByTestId('favorites-confirm')).toHaveAccessibleName(
      'Elimină Bogdan din favorite',
    );

    // Lista de după eliminare, pentru refetch-ul declanșat de invalidare.
    vi.mocked(fetchFavoritesPage).mockResolvedValue(page([]));
    fireEvent.click(screen.getByTestId('favorites-confirm-accept'));

    await waitFor(() => expect(removeFavorite).toHaveBeenCalledWith('u2'));
    await waitFor(() =>
      expect(screen.queryByTestId('favorite-remove-u2')).not.toBeInTheDocument(),
    );
  });

  it('anularea nu trimite nimic la server', async () => {
    renderWithProviders(<FavoritesScreen />);

    fireEvent.click(await screen.findByTestId('favorite-remove-u2'));
    fireEvent.click(screen.getByTestId('favorites-confirm-cancel'));

    expect(screen.queryByTestId('favorites-confirm')).not.toBeInTheDocument();
    expect(removeFavorite).not.toHaveBeenCalled();
    expect(screen.getByText('Bogdan, 31')).toBeInTheDocument();
  });

  it('eșecul se scrie în pagină, iar ecranul NU se golește', async () => {
    vi.mocked(removeFavorite).mockRejectedValue(new Error('500'));
    renderWithProviders(<FavoritesScreen />);

    fireEvent.click(await screen.findByTestId('favorite-remove-u2'));
    fireEvent.click(screen.getByTestId('favorites-confirm-accept'));

    expect(await screen.findByTestId('favorites-remove-error')).toHaveTextContent(
      'Nu am putut elimina din favorite. Reîncearcă.',
    );
    // Rândul e tot acolo: eroarea nu are voie să golească lista.
    expect(screen.getByText('Bogdan, 31')).toBeInTheDocument();
    expect(screen.getByTestId('favorite-remove-u2')).toBeInTheDocument();
  });
});

describe('adăugarea la favorite din „Le-ai dat like"', () => {
  it('★ trimite cererea și reîmprospătează favoritele', async () => {
    renderWithProviders(<FavoritesScreen />);

    fireEvent.click(await screen.findByTestId('like-favorite-u1'));

    await waitFor(() => expect(addFavorite).toHaveBeenCalledWith('u1'));
  });

  it('eșecul se scrie în pagină, fără alert', async () => {
    vi.mocked(addFavorite).mockRejectedValue(new Error('500'));
    renderWithProviders(<FavoritesScreen />);

    fireEvent.click(await screen.findByTestId('like-favorite-u1'));

    expect(await screen.findByTestId('favorites-add-error')).toHaveTextContent(
      'Nu am putut adăuga la favorite. Reîncearcă.',
    );
    expect(screen.getByText('Ana, 27')).toBeInTheDocument();
  });
});

describe('paginare pe cursor', () => {
  it('„Încarcă mai multe" adaugă pagina următoare sub cea adusă', async () => {
    vi.mocked(fetchLikesSentPage)
      .mockResolvedValueOnce(page([ANA], 'cursor-2'))
      .mockResolvedValueOnce(page([CARINA]));
    renderWithProviders(<FavoritesScreen />);

    fireEvent.click(await screen.findByTestId('likes-load-more'));

    expect(await screen.findByText('Carina, 24')).toBeInTheDocument();
    // Pagina 1 rămâne pe ecran: paginile se adună, nu se înlocuiesc.
    expect(screen.getByText('Ana, 27')).toBeInTheDocument();
    expect(fetchLikesSentPage).toHaveBeenLastCalledWith({ cursor: 'cursor-2' });
  });

  it('o eroare la pagina 2 NU șterge pagina 1', async () => {
    vi.mocked(fetchLikesSentPage)
      .mockResolvedValueOnce(page([ANA], 'cursor-2'))
      .mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<FavoritesScreen />);

    fireEvent.click(await screen.findByTestId('likes-load-more'));

    expect(await screen.findByTestId('likes-load-more-error')).toHaveTextContent(
      'Nu am putut încărca mai multe.',
    );
    expect(screen.getByText('Ana, 27')).toBeInTheDocument();
    expect(screen.queryByTestId('favorites-error')).not.toBeInTheDocument();
  });
});
