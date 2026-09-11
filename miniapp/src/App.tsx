/**
 * Rădăcina Mini App-ului: pornire Telegram → autentificare → ecranul de swipe.
 *
 * Autentificarea rulează la FIECARE pornire, din `initData`. Nu există hidratare
 * dintr-o sesiune salvată — motivul stă în `api/tokenStore.ts`.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/auth/authStore';
import { SwipeDeck } from '@/features/feed/SwipeDeck';
import { useTelegramBootstrap, useTelegramChrome } from '@/telegram/useTelegram';

/** Ecran de stare, cu titlu, explicație și (opțional) o acțiune. */
function StatusScreen({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="screen-center">
      <h1 className="title">{title}</h1>
      {body ? <p className="body-text">{body}</p> : null}
      {action ? (
        <button type="button" className="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function App() {
  const { t } = useTranslation('miniapp');
  useTelegramBootstrap();
  useTelegramChrome();

  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const optimisticName = useAuthStore((s) => s.optimisticName);
  const signIn = useAuthStore((s) => s.signIn);

  useEffect(() => {
    void signIn();
  }, [signIn]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="app-shell">
        <div className="screen-center">
          <div className="spinner" role="status" aria-label={t('app.connecting')} />
          {/* Numele NEVERIFICAT din initDataUnsafe: doar ca ecranul să nu fie
              gol cât timp cererea e în zbor. Nu decide nimic. */}
          <p className="body-text">
            {optimisticName ? t('app.greeting', { name: optimisticName }) : t('app.connecting')}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error' && error) {
    // „În afara Telegram" nu se rezolvă printr-o reîncercare: fără SDK nu există
    // `initData`, deci nu oferim un buton care ar eșua garantat.
    const retryable = error !== 'outside_telegram';
    return (
      <div className="app-shell">
        <StatusScreen
          title={t(`errors.${error}.title`)}
          body={t(`errors.${error}.body`)}
          {...(retryable
            ? { action: { label: t('actions.retry', { ns: 'common' }), onClick: () => void signIn() } }
            : {})}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SwipeDeck />
    </div>
  );
}
