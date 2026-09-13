/**
 * Utilizatori blocați (TZ secț. 6.2) în Mini App: listă paginată pe cursor +
 * deblocare.
 *
 * PORT DOM al lui `mobile/app/blocklist.tsx`. Două diferențe deliberate față de
 * ecranul nativ:
 *  - DEBLOCAREA CERE CONFIRMARE. Pe mobil butonul deblochează direct; aici
 *    butonul „Deblochează" stă lipit de numele persoanei, într-o listă densă și
 *    atinsă cu degetul, iar o apăsare greșită readuce în feed exact pe cine ai
 *    scos de acolo. Confirmarea NU e marcată `destructive`: deblocarea nu
 *    distruge nimic, se poate bloca la loc oricând.
 *  - FĂRĂ `alert()`: eroarea de deblocare se scrie ÎN pagină (dialogurile
 *    native îngheață WebView-ul Telegram).
 *
 * Nu portăm „infinite scroll la capătul listei" din mobil: zona care derulează
 * e cadrul (`.app-shell__content`), nu lista, deci un `onEndReached` ar trebui
 * legat de scroll-ul altui modul. Butonul „Încarcă mai multe" rămâne, și e
 * oricum singurul pe care mobilul îl arată utilizatorului.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from './ConfirmModal';
import { fetchBlocks, unblock, type BlockedUser } from './socialApi';

import './social.css';

export function BlocklistScreen() {
  // `settings` e catalogul mobil REUTILIZAT (titlu, „Deblochează", erori);
  // `screens` e catalogul propriu, pentru întrebarea de confirmare, care pe
  // nativ nu există (acolo deblocarea e directă).
  const { t } = useTranslation(['settings', 'screens']);
  const queryClient = useQueryClient();

  /** Persoana pentru care s-a cerut deblocarea (`null` = fără dialog). */
  const [pending, setPending] = useState<BlockedUser | null>(null);
  /** Ultima deblocare a eșuat: mesajul stă în pagină, lista rămâne pe ecran. */
  const [failed, setFailed] = useState(false);

  // Backendul paginează pe cursor (`X-Next-Cursor`), deci `useInfiniteQuery`:
  // el acumulează paginile în cache, fără stare locală care s-ar pierde la
  // refetch-ul de după deblocare.
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery({
    queryKey: ['blocks'],
    queryFn: ({ pageParam }) => fetchBlocks({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const unblockMutation = useMutation({
    mutationFn: (blockedId: string) => unblock(blockedId),
    onSuccess: () => {
      setPending(null);
      setFailed(false);
      // Aceleași trei cozi ca la blocare (`useBlockUser` pe mobil): persoana
      // reapare imediat în feed și în lista de dialoguri, nu la următoarea
      // pornire a aplicației.
      void queryClient.invalidateQueries({ queryKey: ['blocks'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: () => {
      setPending(null);
      setFailed(true);
    },
  });

  const title = <h1 className="title so-screen__title">{t('settings:blocklist.title')}</h1>;

  if (isLoading) {
    return (
      <div className="so-screen">
        {title}
        <div className="so-state">
          <div className="spinner" role="status" aria-label={t('settings:blocklist.title')} />
        </div>
      </div>
    );
  }

  // Ecran de eroare DOAR când n-avem nimic de arătat. Dacă pagina 1 e pe ecran
  // și pică pagina 2, lista rămâne, iar eroarea apare în piciorul ei.
  if (isError && data === undefined) {
    return (
      <div className="so-screen">
        {title}
        <div className="so-state" data-testid="blocklist-error">
          <p className="error-text">{t('settings:blocklist.loadError')}</p>
          <button
            type="button"
            className="button"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {t('settings:retry')}
          </button>
        </div>
      </div>
    );
  }

  // Paginile aduse până acum, aplatizate într-o singură listă.
  const blocks = data?.pages.flatMap((p) => p.items) ?? [];

  let footer: ReactElement | null = null;
  if (hasNextPage || isFetchNextPageError) {
    footer = isFetchingNextPage ? (
      <div className="so-section__footer">
        <div
          className="spinner"
          role="status"
          data-testid="blocks-loading-more"
          aria-label={t('settings:blocklist.loadMore')}
        />
      </div>
    ) : (
      <div className="so-section__footer">
        {isFetchNextPageError ? (
          <p className="error-text so-error" data-testid="blocks-load-more-error">
            {t('settings:blocklist.loadMoreError')}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--ghost"
          data-testid="blocks-load-more"
          onClick={() => void fetchNextPage()}
        >
          {isFetchNextPageError ? t('settings:retry') : t('settings:blocklist.loadMore')}
        </button>
      </div>
    );
  }

  return (
    <div className="so-screen">
      {title}

      {failed ? (
        <p className="error-text so-error" data-testid="blocklist-unblock-error">
          {t('settings:blocklist.unblockErrorBody')}
        </p>
      ) : null}

      {blocks.length === 0 ? (
        <div className="so-state" data-testid="blocklist-empty">
          <p className="body-text">{t('settings:blocklist.empty')}</p>
        </div>
      ) : (
        <>
          <ul className="so-rows">
            {blocks.map((item) => {
              const busy =
                unblockMutation.isPending && unblockMutation.variables === item.blockedId;
              return (
                <li key={item.blockedId} className="so-row" data-testid={`block-${item.blockedId}`}>
                  <span className="so-row__name so-row__name--wide">{item.name}</span>
                  <button
                    type="button"
                    className="button button--ghost so-row__button"
                    disabled={busy}
                    data-testid={`blocklist-unblock-${item.blockedId}`}
                    onClick={() => {
                      setFailed(false);
                      setPending(item);
                    }}
                  >
                    {t('settings:blocklist.unblock')}
                  </button>
                </li>
              );
            })}
          </ul>
          {footer}
        </>
      )}

      <ConfirmModal
        open={pending !== null}
        title={t('settings:blocklist.unblock')}
        body={
          pending ? t('screens:social.unblockConfirm', { name: pending.name }) : undefined
        }
        confirmLabel={t('settings:blocklist.unblock')}
        busy={unblockMutation.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) unblockMutation.mutate(pending.blockedId);
        }}
        testId="blocklist-confirm"
      />
    </div>
  );
}

export default BlocklistScreen;
