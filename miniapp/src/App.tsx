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

import type { AuthErrorKind } from '@/auth/telegramAuth';
import { useAuthStore } from '@/auth/authStore';
import { StatusScreen, type StatusAction } from '@/components/StatusScreen';
import { getLegalUrls } from '@/config';
import { AppRoutes } from '@/routes';
import { telegramBotAction } from '@/telegram/botLink';
import { useTelegramBootstrap, useTelegramChrome } from '@/telegram/useTelegram';

import '@/styles/shell.css';
import '@/styles/forms.css';

/**
 * Ce poate face utilizatorul în fiecare stare de eroare.
 *
 * Regula: niciun ecran fără ieșire. „În afara Telegram" nu se rezolvă printr-o
 * reîncercare (fără SDK nu există `initData`, deci ar eșua garantat) — singura
 * acțiune corectă acolo e butonul care duce în chatul botului. Datele expirate
 * sau invalide se rezolvă cel mai des tot prin redeschidere din chat, deci
 * primesc reîncercarea ca acțiune principală și Telegramul ca a doua.
 *
 * „Cont interzis" e singura stare fără reîncercare deloc: acolo serverul a luat
 * o decizie despre CONT, nu despre datele de conectare, iar a mai încerca o dată
 * e garantat inutil.
 */
export function errorActions(
  error: AuthErrorKind,
  labels: { retry: string; openTelegram: string; support: string },
  retry: () => void,
): StatusAction[] {
  const toTelegram = (ghost: boolean) =>
    telegramBotAction({ label: labels.openTelegram, ghost });

  if (error === 'outside_telegram') {
    const action = toTelegram(false);
    return action ? [action] : [];
  }

  if (error === 'banned') {
    // NICIUN buton de reîncercare, și nici măcar „deschide în Telegram":
    // serverul răspunde 403 la fiecare `POST /auth/telegram`, indiferent de cât
    // de proaspăt e `initData`. Un buton acolo ar fi o buclă infinită pentru om
    // și un slot consumat din limita de cereri la fiecare apăsare.
    // Ieșirea care rămâne e singura reală: pagina de suport, unde un ban se
    // poate contesta.
    const support = getLegalUrls().supportUrl;
    return support
      ? [{ label: labels.support, href: support, testId: 'auth-support' }]
      : [];
  }

  const actions: StatusAction[] = [
    { label: labels.retry, onClick: retry, testId: 'auth-retry' },
  ];
  if (error === 'expired' || error === 'invalid') {
    const action = toTelegram(true);
    if (action) actions.push(action);
  }
  return actions;
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
        {/* Numele NEVERIFICAT din initDataUnsafe: doar ca ecranul să nu fie gol
            cât timp cererea e în zbor. Nu decide nimic. */}
        <StatusScreen
          loading
          testId="status-loading"
          title={
            optimisticName ? t('app.greeting', { name: optimisticName }) : t('app.connecting')
          }
          body={t('app.connectingBody')}
        />
      </div>
    );
  }

  if (status === 'error' && error) {
    return (
      <div className="app-shell">
        <StatusScreen
          testId={`status-${error}`}
          title={t(`errors.${error}.title`)}
          body={t(`errors.${error}.body`)}
          actions={errorActions(
            error,
            {
              retry: t('actions.retry', { ns: 'common' }),
              openTelegram: t('actions.openInTelegram'),
              support: t('actions.contactSupport'),
            },
            () => void signIn(),
          )}
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
