/**
 * Ecranul „Favorite" (TZ secț. 6.1) pentru Mini App.
 *
 * PORT DOM al lui `mobile/app/favorites.tsx`, cu aceleași DOUĂ secțiuni:
 *   1. „Le-ai dat like" — profilurile apreciate cu swipe dreapta în deck
 *      (`GET /social/likes/sent`);
 *   2. „Favorite ★"      — profilurile marcate manual (`GET /social/favorites`).
 *
 * DE CE SECȚIUNI ȘI NU UN TOGGLE (motivul e copiat din ecranul nativ): cele
 * două liste au sensuri diferite — una e istoricul swipe-urilor, alta o colecție
 * intenționată — iar un toggle ar ascunde-o pe una. Cu zero favorite, userul ar
 * vedea tot un ecran gol și n-ar afla niciodată că ★ există.
 *
 * DIFERENȚE FAȚĂ DE MOBIL, deliberate:
 *  - fără `alert()`: eroarea de eliminare se scrie ÎN pagină, iar confirmarea
 *    trece prin `ConfirmModal` (dialogurile native îngheață WebView-ul Telegram);
 *  - „e deja favorit?" se citește din paginile DEJA aduse de interogarea
 *    `['favorites']`, nu printr-o a doua cerere de listă (pe mobil, `useFavorite`
 *    mai cere o dată prima pagină pentru fiecare card). O singură sursă de
 *    adevăr, zero trafic în plus.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from './ConfirmModal';
import {
  addFavorite,
  fetchFavoritesPage,
  fetchLikesSentPage,
  removeFavorite,
  type FavoriteItem,
} from './socialApi';

import './social.css';

/** Avatarul din rând: prima poză a profilului sau inițiala numelui. */
function Avatar({ item }: { item: FavoriteItem }) {
  // `noUncheckedIndexedAccess`: primul element poate lipsi, deci îl tratăm ca
  // opțional — un profil fără poze e cazul obișnuit, nu o excepție.
  const photo = item.photos[0];
  if (photo) {
    // `alt` gol: numele e deja scris alături, iar un cititor de ecran care
    // repetă „Ana" de două ori pe același rând e zgomot, nu accesibilitate.
    return <img className="so-row__avatar" src={photo} alt="" loading="lazy" />;
  }
  const initial = item.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="so-row__avatar so-row__avatar--initial" aria-hidden="true">
      {initial}
    </div>
  );
}

/** Datele comune celor două tipuri de rând: avatar, „nume, vârstă", oraș. */
function RowBody({ item }: { item: FavoriteItem }) {
  return (
    <>
      <Avatar item={item} />
      <div className="so-row__info">
        <span className="so-row__name">
          {item.name}, {item.age}
        </span>
        <span className="caption so-row__city">{item.city}</span>
      </div>
    </>
  );
}

/** O secțiune a ecranului, cu tot ce-i trebuie piciorului ei de paginare. */
interface Section {
  key: 'likes' | 'favorites';
  title: string;
  hint: string;
  items: FavoriteItem[];
  /** Backendul a trimis `X-Next-Cursor` → mai există cel puțin o pagină. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Ultima încercare de „încarcă mai multe" a picat (paginile aduse RĂMÂN). */
  failedMore: boolean;
  loadMore: () => void;
}

export function FavoritesScreen() {
  const { t } = useTranslation('social');
  const queryClient = useQueryClient();

  /** Profilul pentru care s-a cerut scoaterea din favorite (`null` = fără dialog). */
  const [pendingRemove, setPendingRemove] = useState<FavoriteItem | null>(null);
  /** Ultima eliminare a eșuat: mesajul stă în pagină, lista rămâne pe ecran. */
  const [removeFailed, setRemoveFailed] = useState(false);
  /** Ultima adăugare la favorite (☆) a eșuat. */
  const [addFailed, setAddFailed] = useState(false);

  // Ambele liste sunt paginate pe cursor de backend (`X-Next-Cursor`), deci
  // `useInfiniteQuery`: el ține paginile în cache și le concatenează singur, în
  // loc să acumulăm noi în `useState` (unde un refetch de după o eliminare ar
  // pune prima pagină peste restul).
  const favoritesQuery = useInfiniteQuery({
    queryKey: ['favorites'],
    queryFn: ({ pageParam }) => fetchFavoritesPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const likesQuery = useInfiniteQuery({
    queryKey: ['likes-sent'],
    queryFn: ({ pageParam }) => fetchLikesSentPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const removeMutation = useMutation({
    mutationFn: (targetUserId: string) => removeFavorite(targetUserId),
    onSuccess: () => {
      setPendingRemove(null);
      setRemoveFailed(false);
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: () => {
      // Dialogul se închide, dar ecranul NU se golește: eroarea se vede sub
      // titlu, iar rândul rămâne exact unde era.
      setPendingRemove(null);
      setRemoveFailed(true);
    },
  });

  const addMutation = useMutation({
    mutationFn: (targetUserId: string) => addFavorite(targetUserId),
    onSuccess: () => {
      setAddFailed(false);
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: () => setAddFailed(true),
  });

  // Loading și eroare se tratează ÎNAINTEA ramurii de gol: un ecran care încă
  // încarcă (sau care a picat) NU are voie să spună „nu ai favorite".
  if (favoritesQuery.isLoading || likesQuery.isLoading) {
    return (
      <div className="so-screen">
        <h1 className="title so-screen__title">{t('favorites.title')}</h1>
        <div className="so-state">
          <div className="spinner" role="status" aria-label={t('favorites.title')} />
        </div>
      </div>
    );
  }

  // Ecranul de eroare e DOAR pentru „n-avem nimic de arătat". O listă care a
  // adus pagina 1 și a picat la pagina 2 rămâne pe ecran, cu eroarea în
  // piciorul secțiunii ei.
  const nothingToShow =
    (favoritesQuery.isError && favoritesQuery.data === undefined) ||
    (likesQuery.isError && likesQuery.data === undefined);

  if (nothingToShow) {
    return (
      <div className="so-screen">
        <h1 className="title so-screen__title">{t('favorites.title')}</h1>
        <div className="so-state" data-testid="favorites-error">
          <p className="error-text">{t('favorites.loadError')}</p>
          <button
            type="button"
            className="button"
            disabled={favoritesQuery.isFetching || likesQuery.isFetching}
            onClick={() => {
              void favoritesQuery.refetch();
              void likesQuery.refetch();
            }}
          >
            {t('favorites.retry')}
          </button>
        </div>
      </div>
    );
  }

  // Paginile aduse până acum, aplatizate într-o singură listă per secțiune.
  const favorites = favoritesQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const likes = likesQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const favoriteIds = new Set(favorites.map((f) => f.targetUserId));

  // Secțiunile goale nu se randează: un antet cu zero rânduri sub el e zgomot.
  const allSections: Section[] = [
    {
      key: 'likes',
      title: t('favorites.sections.likesTitle'),
      hint: t('favorites.sections.likesHint'),
      items: likes,
      hasMore: likesQuery.hasNextPage,
      loadingMore: likesQuery.isFetchingNextPage,
      failedMore: likesQuery.isFetchNextPageError,
      loadMore: () => void likesQuery.fetchNextPage(),
    },
    {
      key: 'favorites',
      title: t('favorites.sections.favoritesTitle'),
      hint: t('favorites.sections.favoritesHint'),
      items: favorites,
      hasMore: favoritesQuery.hasNextPage,
      loadingMore: favoritesQuery.isFetchingNextPage,
      failedMore: favoritesQuery.isFetchNextPageError,
      loadMore: () => void favoritesQuery.fetchNextPage(),
    },
  ];
  const sections = allSections.filter((section) => section.items.length > 0);

  /** Rândul dintr-o secțiune, cu acțiunea potrivită în dreapta. */
  function renderRow(section: Section, item: FavoriteItem): ReactElement {
    if (section.key === 'favorites') {
      const removing =
        removeMutation.isPending && removeMutation.variables === item.targetUserId;
      return (
        <li key={item.targetUserId} className="so-row">
          <RowBody item={item} />
          <button
            type="button"
            className="so-row__action"
            aria-label={t('favorites.remove', { name: item.name })}
            disabled={removing}
            data-testid={`favorite-remove-${item.targetUserId}`}
            onClick={() => {
              setRemoveFailed(false);
              setPendingRemove(item);
            }}
          >
            {removing ? <span className="spinner so-spinner--inline" /> : '♥'}
          </button>
        </li>
      );
    }

    // Steaua plină înseamnă „e deja în favorite", deci butonul n-are ce face.
    const isFavorite = favoriteIds.has(item.targetUserId);
    const adding = addMutation.isPending && addMutation.variables === item.targetUserId;
    const star = isFavorite ? '★' : '☆';
    return (
      <li key={item.targetUserId} className="so-row">
        <RowBody item={item} />
        <button
          type="button"
          className="so-row__action"
          aria-label={
            isFavorite
              ? t('favorites.already', { name: item.name })
              : t('favorites.add', { name: item.name })
          }
          aria-pressed={isFavorite}
          disabled={isFavorite || adding}
          data-testid={`like-favorite-${item.targetUserId}`}
          onClick={() => {
            setAddFailed(false);
            addMutation.mutate(item.targetUserId);
          }}
        >
          {adding ? <span className="spinner so-spinner--inline" /> : star}
        </button>
      </li>
    );
  }

  /**
   * Piciorul unei secțiuni: „Încarcă mai multe" / spinner / eroare de paginare.
   * Eroarea la pagina 2 stă AICI, sub rândurile deja aduse — nu are voie să
   * înlocuiască pagina 1 cu un ecran de eroare.
   */
  function renderFooter(section: Section): ReactElement | null {
    if (!section.hasMore && !section.failedMore) return null;
    if (section.loadingMore) {
      return (
        <div className="so-section__footer">
          <div
            className="spinner"
            role="status"
            data-testid={`${section.key}-loading-more`}
            aria-label={t('favorites.loadMore')}
          />
        </div>
      );
    }
    return (
      <div className="so-section__footer">
        {section.failedMore ? (
          <p className="error-text so-error" data-testid={`${section.key}-load-more-error`}>
            {t('favorites.loadMoreError')}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--ghost"
          data-testid={`${section.key}-load-more`}
          onClick={section.loadMore}
        >
          {section.failedMore ? t('favorites.retry') : t('favorites.loadMore')}
        </button>
      </div>
    );
  }

  return (
    <div className="so-screen">
      <h1 className="title so-screen__title">{t('favorites.title')}</h1>

      {removeFailed ? (
        <p className="error-text so-error" data-testid="favorites-remove-error">
          {t('favorites.removeErrorBody')}
        </p>
      ) : null}
      {addFailed ? (
        <p className="error-text so-error" data-testid="favorites-add-error">
          {t('favorites.addErrorBody')}
        </p>
      ) : null}

      {sections.length === 0 ? (
        <div className="so-state" data-testid="favorites-empty">
          <p className="body-text">{t('favorites.empty')}</p>
          <p className="caption">{t('favorites.emptyHint')}</p>
        </div>
      ) : (
        <div className="so-sections">
          {sections.map((section) => (
            <section key={section.key} className="so-section">
              <h2 className="so-section__title">{section.title}</h2>
              <p className="caption">{section.hint}</p>
              <ul className="so-rows">{section.items.map((item) => renderRow(section, item))}</ul>
              {renderFooter(section)}
            </section>
          ))}
        </div>
      )}

      <ConfirmModal
        open={pendingRemove !== null}
        title={
          pendingRemove
            ? t('favorites.remove', { name: pendingRemove.name })
            : t('favorites.title')
        }
        /* Textul întrebării nu are cheie în catalogul mobil, iar cataloagele nu
           se modifică din Mini App: îl scriem în română, ca pe mobil. */
        body="Îl scoți din lista de favorite? Îl poți adăuga oricând la loc."
        busy={removeMutation.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) removeMutation.mutate(pendingRemove.targetUserId);
        }}
        testId="favorites-confirm"
      />
    </div>
  );
}

export default FavoritesScreen;
