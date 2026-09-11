/**
 * Rădăcina Mini App-ului: pornire Telegram → autentificare → rutare.
 *
 * Autentificarea rulează la FIECARE pornire, din `initData`. Nu există hidratare
 * dintr-o sesiune salvată — motivul stă în `api/tokenStore.ts`.
 *
 * DE CE `MemoryRouter` ȘI NU `HashRouter`/`BrowserRouter`
 * ------------------------------------------------------
 * Mini App-ul e servit dintr-un singur fișier, deci `BrowserRouter` ar cere o
 * regulă de rescriere pe server pentru fiecare cale — o reîncărcare pe `/feed`
 * ar da 404. Rămâneau `HashRouter` și `MemoryRouter`.
 *
 * `HashRouter` e EXCLUS pentru un motiv concret, nu de stil: Telegram transmite
 * datele de deschidere chiar în FRAGMENTUL adresei
 * (`#tgWebAppData=…&tgWebAppVersion=…&tgWebAppThemeParams=…`). Un router care
 * scrie în `location.hash` le suprascrie la prima navigare; după asta, orice
 * reîncărcare a paginii pornește fără `initData`, adică fără nicio dovadă de
 * identitate, iar aplicația nu se mai poate autentifica.
 *
 * În plus, istoricul browserului se comportă neuniform în WebView-ul Telegram:
 * pe unele clienți gestul „înapoi" al sistemului închide Mini App-ul în loc să
 * întoarcă o intrare de istoric. `MemoryRouter` ține istoricul în memorie, nu
 * atinge deloc adresa, iar navigarea în adâncime se face prin butonul ÎNAPOI
 * nativ al Telegramului (vezi `components/DeepScreen.tsx`). Costul acceptat:
 * o reîncărcare a paginii repornește de la rută zero — ceea ce e oricum
 * comportamentul corect, fiindcă și autentificarea o ia de la capăt.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import { useAuthStore } from '@/auth/authStore';
import { StatusScreen } from '@/components/StatusScreen';
import { AppRoutes } from '@/routes';
import { useTelegramBootstrap, useTelegramChrome } from '@/telegram/useTelegram';

import '@/styles/shell.css';
import '@/styles/forms.css';

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
            ? {
                actions: [
                  { label: t('actions.retry', { ns: 'common' }), onClick: () => void signIn() },
                ],
              }
            : {})}
        />
      </div>
    );
  }

  return (
    <MemoryRouter>
      <AppRoutes />
    </MemoryRouter>
  );
}
