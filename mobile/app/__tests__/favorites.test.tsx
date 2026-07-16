import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import FavoritesScreen from '../favorites';
import { ThemeProvider } from '@theme/index';
import type { FavoriteItem, Page, PageParams } from '@/features/social/socialApi';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

// Mock la socialApi: pagini controlate + spionăm scrierile.
type FavPage = Page<FavoriteItem>;
const emptyPage = (): FavPage => ({ items: [], nextCursor: null });

const mockFetchFavoritesPage = jest.fn<Promise<FavPage>, [PageParams | undefined]>(() =>
  Promise.resolve(emptyPage()),
);
const mockFetchLikesSentPage = jest.fn<Promise<FavPage>, [PageParams | undefined]>(() =>
  Promise.resolve(emptyPage()),
);
// `useFavorite` (steaua din „Le-ai dat like") citește lista simplă, nepaginată.
const mockFetchFavorites = jest.fn<Promise<FavoriteItem[]>, []>(() => Promise.resolve([]));
const mockRemoveFavorite = jest.fn((_id: string) => Promise.resolve());
const mockAddFavorite = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/features/social/socialApi', () => ({
  fetchFavoritesPage: (params?: PageParams) => mockFetchFavoritesPage(params),
  fetchLikesSentPage: (params?: PageParams) => mockFetchLikesSentPage(params),
  fetchFavorites: () => mockFetchFavorites(),
  removeFavorite: (id: string) => mockRemoveFavorite(id),
  addFavorite: (id: string) => mockAddFavorite(id),
}));

function item(over: Partial<FavoriteItem> & { targetUserId: string }): FavoriteItem {
  return { name: 'X', age: 20, city: 'Chișinău', photos: [], ...over };
}

/** O pagină „ultima" (fără cursor mai departe). */
function lastPage(items: FavoriteItem[]): FavPage {
  return { items, nextCursor: null };
}

const favorites: FavoriteItem[] = [
  item({ targetUserId: 'u1', name: 'Ana', age: 25, city: 'Chișinău' }),
  item({ targetUserId: 'u2', name: 'Maria', age: 28, city: 'Bălți' }),
];

const likesSent: FavoriteItem[] = [
  item({ targetUserId: 'u3', name: 'Ion', age: 30, city: 'Orhei' }),
];

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <FavoritesScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('FavoritesScreen', () => {
  beforeEach(() => {
    mockFetchFavoritesPage.mockReset();
    mockFetchLikesSentPage.mockReset();
    mockFetchFavorites.mockReset();
    mockRemoveFavorite.mockClear();
    mockAddFavorite.mockClear();
    mockFetchFavoritesPage.mockResolvedValue(emptyPage());
    mockFetchLikesSentPage.mockResolvedValue(emptyPage());
    mockFetchFavorites.mockResolvedValue([]);
  });

  it('afișează AMBELE secțiuni, etichetate distinct', async () => {
    mockFetchFavoritesPage.mockResolvedValue(lastPage(favorites));
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    const { getByText } = renderScreen();

    // Secțiunea de like-uri (automată, din deck).
    await waitFor(() => getByText('Le-ai dat like'));
    expect(getByText('Ion, 30')).toBeTruthy();

    // Secțiunea de favorite (marcate manual cu ★).
    expect(getByText('Favorite ★')).toBeTruthy();
    expect(getByText('Ana, 25')).toBeTruthy();
    expect(getByText('Maria, 28')).toBeTruthy();
  });

  it('o secțiune fără date nu se randează, cealaltă rămâne etichetată', async () => {
    mockFetchFavoritesPage.mockResolvedValue(lastPage([]));
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    const { getByText, queryByText } = renderScreen();

    await waitFor(() => getByText('Le-ai dat like'));
    expect(queryByText('Favorite ★')).toBeNull();
    expect(queryByText('favorites-empty')).toBeNull();
  });

  /* --- Loading / eroare / gol: trei stări DISTINCTE --- */

  it('cât timp încarcă afișează spinner, NU starea goală', () => {
    // Promisiuni care nu se rezolvă → rămânem în isLoading.
    mockFetchFavoritesPage.mockReturnValue(new Promise(() => {}));
    mockFetchLikesSentPage.mockReturnValue(new Promise(() => {}));
    const { getByTestId, queryByTestId } = renderScreen();

    expect(getByTestId('favorites-loading')).toBeTruthy();
    expect(queryByTestId('favorites-empty')).toBeNull();
  });

  it('la eroare afișează mesaj + „Reîncearcă", NU starea goală', async () => {
    mockFetchFavoritesPage.mockRejectedValue(new Error('boom'));
    mockFetchLikesSentPage.mockResolvedValue(lastPage([]));
    const { getByText, queryByTestId } = renderScreen();

    await waitFor(() => getByText('Nu am putut încărca lista.'));
    expect(getByText('Reîncearcă')).toBeTruthy();
    expect(queryByTestId('favorites-empty')).toBeNull();
  });

  it('starea goală apare doar când AMBELE liste sunt goale', async () => {
    mockFetchFavoritesPage.mockResolvedValue(lastPage([]));
    mockFetchLikesSentPage.mockResolvedValue(lastPage([]));
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('favorites-empty'));
    expect(getByText('Încă n-ai dat like nimănui și n-ai marcat pe nimeni cu ★.')).toBeTruthy();
  });

  /* --- Acțiuni --- */

  it('eliminarea din favorite apelează removeFavorite', async () => {
    mockFetchFavoritesPage.mockResolvedValue(lastPage(favorites));
    const { getByLabelText } = renderScreen();

    await waitFor(() => getByLabelText('Elimină Ana din favorite'));
    fireEvent.press(getByLabelText('Elimină Ana din favorite'));

    await waitFor(() => expect(mockRemoveFavorite).toHaveBeenCalledWith('u1'));
  });

  it('★ pe un profil din „Le-ai dat like" îl adaugă la favorite', async () => {
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    const { getByLabelText } = renderScreen();

    await waitFor(() => getByLabelText('Adaugă Ion la favorite'));
    fireEvent.press(getByLabelText('Adaugă Ion la favorite'));

    await waitFor(() => expect(mockAddFavorite).toHaveBeenCalledWith('u3'));
  });

  it('un profil deja favorit din „Le-ai dat like" nu se mai poate adăuga', async () => {
    // Ion e și în lista de like-uri, și în favorite. Steaua se uită la lista
    // simplă a lui `useFavorite`, secțiunea „Favorite ★" la cea paginată.
    const ion = item({ targetUserId: 'u3', name: 'Ion', age: 30 });
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    mockFetchFavoritesPage.mockResolvedValue(lastPage([ion]));
    mockFetchFavorites.mockResolvedValue([ion]);
    const { getByLabelText } = renderScreen();

    await waitFor(() => getByLabelText('Ion e deja la favorite'));
    fireEvent.press(getByLabelText('Ion e deja la favorite'));

    expect(mockAddFavorite).not.toHaveBeenCalled();
  });

  /* --- Paginare pe cursor, per secțiune --- */

  it('prima pagină a fiecărei secțiuni se cere fără cursor', async () => {
    mockFetchFavoritesPage.mockResolvedValue(lastPage(favorites));
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    const { getByText } = renderScreen();

    await waitFor(() => getByText('Ana, 25'));
    expect(mockFetchFavoritesPage).toHaveBeenCalledWith({ cursor: null });
    expect(mockFetchLikesSentPage).toHaveBeenCalledWith({ cursor: null });
  });

  it('fără X-Next-Cursor butonul „încarcă mai multe" NU apare', async () => {
    mockFetchFavoritesPage.mockResolvedValue(lastPage(favorites));
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    const { getByText, queryByTestId } = renderScreen();

    await waitFor(() => getByText('Ana, 25'));
    expect(queryByTestId('favorites-load-more')).toBeNull();
    expect(queryByTestId('likes-load-more')).toBeNull();
  });

  it('cu X-Next-Cursor pagina 2 se ADAUGĂ la pagina 1, doar în secțiunea ei', async () => {
    mockFetchFavoritesPage
      .mockResolvedValueOnce({ items: favorites, nextCursor: 'C2' })
      .mockResolvedValueOnce(lastPage([item({ targetUserId: 'u4', name: 'Elena', age: 22 })]));
    // Like-urile s-au terminat din prima → butonul lor nu apare.
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    const { getByText, getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('favorites-load-more'));
    expect(queryByTestId('likes-load-more')).toBeNull();

    fireEvent.press(getByTestId('favorites-load-more'));

    // Pagina 2 e cerută cu cursorul primit în header.
    await waitFor(() => expect(mockFetchFavoritesPage).toHaveBeenLastCalledWith({ cursor: 'C2' }));
    await waitFor(() => getByText('Elena, 22'));

    // Pagina 1 NU a fost înlocuită.
    expect(getByText('Ana, 25')).toBeTruthy();
    expect(getByText('Maria, 28')).toBeTruthy();
    // Lista s-a terminat → butonul dispare.
    expect(queryByTestId('favorites-load-more')).toBeNull();
  });

  it('eroare la pagina 2: pagina 1 rămâne pe ecran + mesaj', async () => {
    mockFetchFavoritesPage
      .mockResolvedValueOnce({ items: favorites, nextCursor: 'C2' })
      .mockRejectedValueOnce(new Error('boom'));
    mockFetchLikesSentPage.mockResolvedValue(lastPage(likesSent));
    const { getByText, getByTestId, queryByText } = renderScreen();

    await waitFor(() => getByTestId('favorites-load-more'));
    fireEvent.press(getByTestId('favorites-load-more'));

    await waitFor(() => getByTestId('favorites-load-more-error'));

    // Pagina 1 e intactă, ecranul de eroare NU a acoperit lista.
    expect(getByText('Ana, 25')).toBeTruthy();
    expect(getByText('Maria, 28')).toBeTruthy();
    expect(getByText('Ion, 30')).toBeTruthy();
    expect(queryByText('Nu am putut încărca lista.')).toBeNull();
  });
});
